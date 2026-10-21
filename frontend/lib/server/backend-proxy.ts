import 'server-only';
const ingress: {
  verifyProof(request: Request, key: string | undefined): boolean;
  metadataValid(get: (name: string) => string | null): boolean;
} = require('../../server/ingress-policy.cjs');
const FRONTEND = 'http://localhost:3002';
const BACKEND = 'http://127.0.0.1:3001';
export const BODY_LIMIT = 16 * 1024;
export const RESPONSE_LIMIT = 2 * 1024 * 1024;
export const DEADLINE_MS = 15_000;
type Environment = { FRONTEND_CANONICAL_ORIGIN?: string; BACKEND_INTERNAL_ORIGIN?: string; NUUDEL_LOCAL_INGRESS_KEY?: string; NUUDEL_LOCAL_INGRESS_MODE?: string; NODE_ENV?: string };
type Dependencies = { env: Environment; fetch: typeof fetch; timeoutMs?: number };
class ProxyError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
function failure(code: string, status: number) {
  return Response.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } });
}
function allowed(path: string, method: string) {
  if (method === 'POST') return /^\/api\/(register|auth\/(login|logout)|identity\/(steam|discord)\/start)$/.test(path);
  if (method !== 'GET') return false;
  return /^\/api\/(auth\/(session|csrf|providers)|identity\/status|identity\/(steam|discord)\/callback|leaderboard|tournaments)$/.test(path)
    || /^\/api\/tournaments\/[A-Za-z0-9_-]+$/.test(path) && path !== '/api/tournaments/mine'
    || /^\/api\/players\/NMD-[0-9]+\/history$/.test(path);
}
async function bounded(stream: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new ProxyError('PROXY_TIMEOUT', 504);
      const { done, value } = await reader.read();
      if (signal.aborted) throw new ProxyError('PROXY_TIMEOUT', 504);
      if (done) break;
      total += value.byteLength;
      if (total > limit) { void reader.cancel().catch(() => {}); throw new ProxyError('PROXY_BODY_LIMIT', 413); }
      chunks.push(value);
    }
    const result = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}
export async function proxyRequest(request: Request, dependencies: Dependencies): Promise<Response> {
  const { env } = dependencies;
  if (typeof window !== 'undefined' || env.FRONTEND_CANONICAL_ORIGIN !== FRONTEND || env.BACKEND_INTERNAL_ORIGIN !== BACKEND)
    return failure('PROXY_CONFIGURATION_REQUIRED', 503);
  if (env.NODE_ENV !== 'development' || env.NUUDEL_LOCAL_INGRESS_MODE !== 'development-v1'
    || !ingress.verifyProof(request, env.NUUDEL_LOCAL_INGRESS_KEY)) return failure('INGRESS_REQUIRED', 403);
  const controller = new AbortController();
  let cause: 'deadline' | 'client' | null = null;
  let upstream: Response | undefined;
  let consumed = false;
  const deadline = Date.now() + (dependencies.timeoutMs ?? DEADLINE_MS);
  const timer = setTimeout(() => { if (!cause) cause = 'deadline'; controller.abort(); }, dependencies.timeoutMs ?? DEADLINE_MS);
  const abort = () => { if (!cause) cause = 'client'; controller.abort(); };
  request.signal.addEventListener('abort', abort, { once: true });
  try {
    if (request.signal.aborted) { abort(); throw new ProxyError('CLIENT_CANCELLED', 499); }
    const rawPath = /^http:\/\/[^/]+([^?#]*)/.exec(request.url)?.[1] ?? '';
    if (/%|\\|\/\/|(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath)) throw new ProxyError('INVALID_PATH', 400);
    const url = new URL(request.url);
    if (url.origin !== FRONTEND || request.headers.get('host') !== 'localhost:3002') throw new ProxyError('INVALID_HOST', 403);
    // Incoming forwarding headers were rejected before Next. The proof binds
    // original security headers and target; matching forwarded values alone
    // never establishes provenance. Next supplies only these four fields.
    for (const name of request.headers.keys()) {
      if (name === 'forwarded' || name === 'x-real-ip' || name.startsWith('x-forwarded-') && !['x-forwarded-host','x-forwarded-proto','x-forwarded-port','x-forwarded-for'].includes(name))
        throw new ProxyError('FORWARDING_HEADERS_REJECTED', 403);
    }
    if (request.headers.get('x-forwarded-host') !== 'localhost:3002' || request.headers.get('x-forwarded-proto') !== 'http'
      || request.headers.get('x-forwarded-port') !== '3002' || !['127.0.0.1','::ffff:127.0.0.1'].includes(request.headers.get('x-forwarded-for') ?? ''))
      throw new ProxyError('FORWARDING_HEADERS_REJECTED', 403);
    if (!ingress.metadataValid(name => request.headers.get(name))) throw new ProxyError('INVALID_FETCH_METADATA', 403);
    // Reject encoding, slash ambiguities and dot segments still visible in Request.url.
    if (/%|\\|\/\/|(?:^|\/)\.{1,2}(?:\/|$)/.test(url.pathname) || url.hash || url.username || url.password)
      throw new ProxyError('INVALID_PATH', 400);
    if (url.search.length > 8192) throw new ProxyError('INVALID_QUERY', 400);
    if (!allowed(url.pathname, request.method)) throw new ProxyError('ROUTE_NOT_ALLOWED', 404);
    if (request.method === 'POST' && (request.headers.get('origin') !== FRONTEND || request.headers.get('sec-fetch-site') === 'cross-site'))
      throw new ProxyError('INVALID_ORIGIN', 403);
    const headers = new Headers({ 'x-forwarded-host': 'localhost:3002', 'x-forwarded-proto': 'http', accept: 'application/json' });
    for (const name of ['cookie', 'origin', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user']) {
      const value = request.headers.get(name); if (value !== null) headers.set(name, value);
    }
    let body: Uint8Array | undefined;
    if (request.method === 'POST') {
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ProxyError('JSON_REQUIRED', 415);
      const length = request.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) throw new ProxyError('PROXY_BODY_LIMIT', 413);
      body = await bounded(request.body, BODY_LIMIT, controller.signal);
      headers.set('content-type', 'application/json');
    }
    upstream = await dependencies.fetch(`${BACKEND}${url.pathname}${url.search}`, {
      method: request.method, headers, ...(body ? { body: body as BodyInit } : {}),
      signal: controller.signal, redirect: 'manual', cache: 'no-store',
    });
    const output = new Headers({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      const target = location ? new URL(location, FRONTEND) : null;
      if (!/^\/api\/identity\/(steam|discord)\/callback$/.test(url.pathname) || ![302,303,307,308].includes(upstream.status)
        || !target || target.origin !== FRONTEND || target.pathname !== '/identity' || target.search || target.hash || target.username || target.password)
        throw new ProxyError('UNSAFE_UPSTREAM_REDIRECT', 502);
      output.set('location', target.href);
    }
    const cookies = upstream.headers.getSetCookie();
    if (cookies.some(cookie => /(?:^|;)\s*domain\s*=/i.test(cookie))) throw new ProxyError('UNSAFE_COOKIE_DOMAIN', 502);
    for (const cookie of cookies) output.append('set-cookie', cookie);
    const contentType = upstream.headers.get('content-type');
    if (contentType) output.set('content-type', contentType);
    const bytes = await bounded(upstream.body, RESPONSE_LIMIT, controller.signal);
    consumed = true;
    return new Response([204,205,304].includes(upstream.status) ? null : bytes, { status: upstream.status, headers: output });
  } catch (error) {
    if (cause === 'client') return failure('CLIENT_CANCELLED', 499);
    if (cause === 'deadline') return failure('PROXY_TIMEOUT', 504);
    if (error instanceof ProxyError) return failure(error.code, error.status);
    return failure('UPSTREAM_UNAVAILABLE', 502);
  } finally {
    // Abort even when rejection happens before body consumption. Do not allow
    // rejection to detach an active transfer by clearing its deadline first.
    if (!consumed) {
      const body = upstream?.body;
      const cancellation = body && !body.locked ? body.cancel().then(() => true, () => false) : Promise.resolve(!body);
      controller.abort();
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      const confirmed = await Promise.race([cancellation, new Promise<boolean>(resolve => {
        cleanupTimer = setTimeout(() => resolve(false), Math.max(0, Math.min(1000, deadline - Date.now())));
      })]);
      if (cleanupTimer) clearTimeout(cleanupTimer);
      clearTimeout(timer); request.signal.removeEventListener('abort', abort);
      if (!confirmed) return failure('PROXY_CLEANUP_UNCONFIRMED', 502);
    } else {
      clearTimeout(timer); request.signal.removeEventListener('abort', abort);
    }
  }
}
