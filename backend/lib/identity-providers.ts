import { SecurityError } from './security-error';

export const steamEndpoint = 'https://steamcommunity.com/openid/login';
const openidNamespace = 'http://specs.openid.net/auth/2.0';
export type Provider = 'STEAM' | 'DISCORD';
export function parseProvider(input: string): Provider {
  if (input === 'steam') return 'STEAM';
  if (input === 'discord') return 'DISCORD';
  throw new SecurityError('UNKNOWN_PROVIDER', 404);
}
export function providerAuthorization(provider: Provider, callback: string, state: string) {
  if (provider === 'STEAM') {
    const url = new URL(steamEndpoint);
    const returnTo = new URL(callback); returnTo.searchParams.set('state', state);
    url.search = new URLSearchParams({ 'openid.ns': openidNamespace, 'openid.mode': 'checkid_setup',
      'openid.return_to': returnTo.href, 'openid.realm': new URL(callback).origin,
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select' }).toString();
    return url.href;
  }
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) throw new SecurityError('DISCORD_CONFIGURATION_REQUIRED', 503);
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, response_type: 'code', scope: 'identify',
    redirect_uri: callback, state, prompt: 'consent' }).toString();
  return url.href;
}

export async function verifySteam(params: URLSearchParams, returnTo: string, fetcher: typeof fetch = fetch, now = new Date()) {
  for (const key of params.keys()) if (params.getAll(key).length !== 1) throw new SecurityError('INVALID_PROVIDER_RESPONSE', 400);
  const signed = new Set((params.get('openid.signed') ?? '').split(','));
  if (params.get('openid.ns') !== openidNamespace || params.get('openid.mode') !== 'id_res' ||
      params.get('openid.op_endpoint') !== steamEndpoint || params.get('openid.return_to') !== returnTo ||
      !['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle'].every(key => signed.has(key))) {
    throw new SecurityError('INVALID_PROVIDER_RESPONSE', 400);
  }
  const claimed = params.get('openid.claimed_id') ?? '';
  if (claimed !== params.get('openid.identity') || !/^https:\/\/steamcommunity\.com\/openid\/id\/\d{17}$/.test(claimed)) {
    throw new SecurityError('INVALID_PROVIDER_RESPONSE', 400);
  }
  const nonce = params.get('openid.response_nonce') ?? '';
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z.+$/.test(nonce) ? Date.parse(nonce.slice(0, 20)) : NaN;
  if (!Number.isFinite(timestamp) || Math.abs(now.getTime() - timestamp) > 300_000) throw new SecurityError('EXPIRED_PROVIDER_RESPONSE', 400);
  const body = new URLSearchParams();
  for (const [key, value] of params) if (key.startsWith('openid.')) body.set(key, value);
  body.set('openid.mode', 'check_authentication');
  const response = await fetcher(steamEndpoint, { method: 'POST', body, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!response.ok || !(await response.text()).split(/\r?\n/).includes('is_valid:true')) throw new SecurityError('PROVIDER_VERIFICATION_FAILED', 400);
  return { subject: claimed.split('/').pop()!, nonce };
}

export async function verifyDiscord(code: string, callback: string, fetcher: typeof fetch = fetch) {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) throw new SecurityError('DISCORD_CONFIGURATION_REQUIRED', 503);
  if (!code || code.length > 2048) throw new SecurityError('INVALID_PROVIDER_RESPONSE', 400);
  const response = await fetcher('https://discord.com/api/oauth2/token', { method: 'POST',
    body: new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code', code, redirect_uri: callback }),
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new SecurityError('PROVIDER_VERIFICATION_FAILED', 400);
  const token = await response.json();
  if (typeof token.access_token !== 'string' || token.token_type?.toLowerCase() !== 'bearer' || !String(token.scope).split(' ').includes('identify')) throw new SecurityError('PROVIDER_VERIFICATION_FAILED', 400);
  const userResponse = await fetcher('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` },
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!userResponse.ok) throw new SecurityError('PROVIDER_VERIFICATION_FAILED', 400);
  const user = await userResponse.json();
  if (typeof user.id !== 'string' || !/^\d{17,20}$/.test(user.id) || user.bot || user.system) throw new SecurityError('INVALID_PROVIDER_RESPONSE', 400);
  // Tokens and account profile fields are deliberately not persisted or logged.
  return user.id as string;
}
