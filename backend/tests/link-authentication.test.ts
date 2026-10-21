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
  it.each([{}, {password:'wrong'}, {password:'correct'}])('blocks all linking starts until persistent revocation is available',async input=>{
    mocks.compare.mockResolvedValue(true);
    const response=await POST(request({intent:'LINK',...input}),context);
    expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'LINK_AUTHORIZATION_GENERATION_REQUIRED'});
    expect(mocks.compare).not.toHaveBeenCalled();expect(mocks.challenge).not.toHaveBeenCalled();expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('rejects missing, old or future authentication timestamps, including legacy challenges', () => {
    const now = new Date();
    for (const date of [null, new Date(now.getTime() - 300001), new Date(now.getTime() + 1)]) expect(() => assertFreshLinkAuthentication(date, now)).toThrow('FRESH_AUTHENTICATION_REQUIRED');
    expect(() => assertChallenge({ provider: 'STEAM', intent: 'LINK', expiresAt: new Date(Date.now() + 60000), consumedAt: null }, 'STEAM')).toThrow('FRESH_AUTHENTICATION_REQUIRED');
  });
  it('rejects Steam sign-in before challenge creation', async () => {
    expect((await POST(request({ intent: 'SIGN_IN' }), context)).status).toBe(403);
    expect(mocks.compare).not.toHaveBeenCalled(); expect(mocks.challenge).not.toHaveBeenCalled();
  });
});
