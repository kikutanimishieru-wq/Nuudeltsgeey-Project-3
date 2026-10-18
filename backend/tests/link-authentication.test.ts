import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ compare: vi.fn(), user: vi.fn(), challenge: vi.fn(), audit: vi.fn(), transaction: vi.fn() }));
vi.mock('bcryptjs', () => ({ default: { compare: mocks.compare } }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.user }, $transaction: mocks.transaction } }));
vi.mock('@/lib/session', () => ({ requireUser: async () => ({ id: 'session-user' }) }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
import { POST } from '../app/api/identity/[provider]/start/route';
import { assertFreshLinkAuthentication, assertChallenge } from '../lib/identity';
const context = { params: Promise.resolve({ provider: 'steam' }) };
function request(body: object) { return new Request('https://arena.example/api/identity/steam/start', { method: 'POST', headers: { origin: 'https://arena.example', 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('APP_URL', 'https://arena.example');
  mocks.user.mockResolvedValue({ passwordHash: 'private-hash', accountStatus: 'ACTIVE' });
  mocks.compare.mockResolvedValue(false);
  mocks.transaction.mockImplementation(async fn => fn({ $queryRaw: vi.fn(), user: { findUnique: mocks.user }, identityChallenge: { create: mocks.challenge }, auditEvent: { create: mocks.audit } }));
});
describe('fresh authentication for identity linking', () => {
  it.each([{}, { password: 'wrong' }])('rejects a valid session without the correct current password', async input => {
    const response = await POST(request({ intent: 'LINK', ...input }), context);
    expect(response.status).toBe(401); expect(mocks.challenge).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('private-hash');
  });
  it('records server-side fresh proof only for the current session account', async () => {
    mocks.compare.mockResolvedValue(true);
    const response = await POST(request({ intent: 'LINK', password: 'correct', userId: 'attacker-target', reauthenticatedAt: '2099-01-01' }), context);
    expect(response.status).toBe(200);
    const data = mocks.challenge.mock.calls[0][0].data;
    expect(data.userId).toBe('session-user'); expect(data.reauthenticatedAt).toBeInstanceOf(Date);
    expect(data.reauthenticatedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(data.expiresAt.getTime() - data.reauthenticatedAt.getTime()).toBeLessThanOrEqual(300100);
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('correct');
  });
  it('rejects a concurrent password change before issuing the challenge', async () => {
    mocks.compare.mockResolvedValue(true);
    mocks.user.mockResolvedValueOnce({ passwordHash: 'old-hash', accountStatus: 'ACTIVE' }).mockResolvedValueOnce({ passwordHash: 'new-hash', accountStatus: 'ACTIVE' });
    expect((await POST(request({ intent: 'LINK', password: 'old-password' }), context)).status).toBe(401);
    expect(mocks.challenge).not.toHaveBeenCalled();
  });
  it('rejects missing, old or future authentication timestamps, including legacy challenges', () => {
    const now = new Date();
    for (const date of [null, new Date(now.getTime() - 300001), new Date(now.getTime() + 1)]) expect(() => assertFreshLinkAuthentication(date, now)).toThrow('FRESH_AUTHENTICATION_REQUIRED');
    expect(() => assertChallenge({ provider: 'STEAM', intent: 'LINK', expiresAt: new Date(Date.now() + 60000), consumedAt: null }, 'STEAM')).toThrow('FRESH_AUTHENTICATION_REQUIRED');
  });
  it('keeps provider sign-in separate from linking without requiring a password', async () => {
    expect((await POST(request({ intent: 'SIGN_IN' }), context)).status).toBe(200);
    expect(mocks.compare).not.toHaveBeenCalled(); expect(mocks.challenge.mock.calls[0][0].data.userId).toBeUndefined();
  });
});
