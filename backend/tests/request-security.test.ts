import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('../lib/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }));
import { prisma } from '../lib/prisma';
import { assertSameOrigin, clientRateKey, applicationOrigin } from '../lib/request-security';
import { enforceRateLimit, rateKey } from '../lib/rate-limit';
import { secureMutation } from '../lib/secure-route';
import { SecurityError } from '../lib/security-error';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('mutation security', () => {
  it('rejects absent or foreign origins before any mutation', async () => {
    vi.stubEnv('APP_URL', 'https://arena.example');
    const handler = vi.fn(); const route = secureMutation(handler);
    for (const headers of [new Headers(), new Headers({ origin: 'https://attacker.example' })]) {
      const response = await route(new Request('https://arena.example/api/operation', { method: 'POST', headers }), undefined);
      expect(response.status).toBe(403);
    }
    expect(handler).not.toHaveBeenCalled(); expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('enforces production HTTPS and does not trust forwarded IP by default', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('APP_URL', 'http://arena.example');
    expect(applicationOrigin).toThrow('INVALID_APPLICATION_ORIGIN');
    vi.stubEnv('APP_URL', 'https://arena.example');
    expect(() => assertSameOrigin(new Request('https://arena.example', { headers: { origin: 'https://arena.example' } }))).not.toThrow();
    vi.stubEnv('TRUSTED_CLIENT_IP_HEADER', '');
    expect(clientRateKey(new Request('https://arena.example', { headers: { 'x-forwarded-for': 'attacker-controlled' } }))).toBe('shared-ingress');
  });
  it('hashes private limiter keys and blocks threshold overflow', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret');
    expect(rateKey('login', 'private@example.test')).not.toContain('private');
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ count: 8 }]).mockResolvedValueOnce([{ count: 9 }]);
    await expect(enforceRateLimit('login', 'account', 8)).resolves.toBeUndefined();
    await expect(enforceRateLimit('login', 'account', 8)).rejects.toMatchObject({ status: 429 });
  });
  it('fails closed when the shared limiter database is unavailable', async () => {
    vi.stubEnv('APP_URL', 'https://arena.example'); vi.stubEnv('AUTH_SECRET', 'test-secret');
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('private database connection')); const handler = vi.fn();
    const response = await secureMutation(handler)(new Request('https://arena.example', { method: 'POST', headers: { origin: 'https://arena.example' } }), undefined);
    expect(response.status).toBe(500); expect(await response.text()).not.toContain('private'); expect(handler).not.toHaveBeenCalled();
  });
  it('returns retry guidance without running a limited mutation', async () => {
    vi.stubEnv('APP_URL', 'https://arena.example'); vi.stubEnv('AUTH_SECRET', 'test-secret');
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ count: 121 }]); const handler = vi.fn();
    const response = await secureMutation(handler)(new Request('https://arena.example', { method: 'POST', headers: { origin: 'https://arena.example' } }), undefined);
    expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('60'); expect(handler).not.toHaveBeenCalled();
  });
  it('returns safe permission errors', async () => {
    vi.stubEnv('APP_URL', 'https://arena.example'); vi.stubEnv('AUTH_SECRET', 'test-secret');
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ count: 1 }]);
    const response = await secureMutation(async () => { throw new SecurityError('FORBIDDEN'); })(new Request('https://arena.example', { method: 'POST', headers: { origin: 'https://arena.example' } }), undefined);
    expect(response.status).toBe(403);
  });
});
