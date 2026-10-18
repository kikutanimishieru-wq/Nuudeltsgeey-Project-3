import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), signIn: vi.fn(), challenge: vi.fn(), transaction: vi.fn(), verifySteam: vi.fn(), verifyDiscord: vi.fn(),
  attach: vi.fn(), jar: { get: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/auth', () => ({ auth: mocks.auth, signIn: mocks.signIn }));
vi.mock('next/headers', () => ({ cookies: async () => mocks.jar }));
vi.mock('@/lib/prisma', () => ({ prisma: { identityChallenge: { findUnique: mocks.challenge }, $transaction: mocks.transaction } }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('@/lib/identity-providers', async importOriginal => ({ ...await importOriginal<object>(), verifySteam: mocks.verifySteam, verifyDiscord: mocks.verifyDiscord }));
vi.mock('@/lib/identity', async importOriginal => ({ ...await importOriginal<object>(), attachVerifiedIdentity: mocks.attach }));
import { GET } from '../app/api/identity/[provider]/callback/route';
import { digest, newSecret } from '../lib/identity';
const state = newSecret(); const browser = newSecret();
const request = () => new Request(`https://arena.example/api/identity/discord/callback?state=${state}&code=provider-code`);
const params = { params: Promise.resolve({ provider: 'discord' }) };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('APP_URL', 'https://arena.example');
  mocks.jar.get.mockReturnValue({ value: browser });
  mocks.challenge.mockResolvedValue({ tokenHash: digest(state), provider: 'DISCORD', intent: 'LINK', reauthenticatedAt: new Date(), userId: 'account', browserHash: digest(browser), expiresAt: new Date(Date.now() + 60000), consumedAt: null });
  mocks.auth.mockResolvedValue({ user: { id: 'account' } });
  mocks.verifyDiscord.mockResolvedValue('123456789012345678');
});
describe('identity callback boundary', () => {
  it('rejects changed sessions before requesting provider proof', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'different-account' } });
    const response = await GET(request(), params);
    expect(response.status).toBe(403); expect(mocks.verifyDiscord).not.toHaveBeenCalled(); expect(mocks.attach).not.toHaveBeenCalled();
  });
  it('rejects stolen state without the correct browser cookie', async () => {
    mocks.jar.get.mockReturnValue({ value: 'attacker-browser' });
    expect((await GET(request(), params)).status).toBe(400);
    expect(mocks.verifyDiscord).not.toHaveBeenCalled();
  });
  it('rejects replay races even after valid provider proof', async () => {
    mocks.transaction.mockImplementation(async fn => fn({ identityChallenge: { updateMany: async () => ({ count: 0 }) } }));
    expect((await GET(request(), params)).status).toBe(409); expect(mocks.attach).not.toHaveBeenCalled();
  });
  it('links only the initiating user and uses a fixed private redirect', async () => {
    mocks.transaction.mockImplementation(async fn => fn({ identityChallenge: { updateMany: async () => ({ count: 1 }) } }));
    const response = await GET(request(), params);
    expect(response.status).toBe(307); expect(response.headers.get('location')).toBe('https://arena.example/identity');
    expect(mocks.attach).toHaveBeenCalledWith(expect.anything(), 'account', 'DISCORD', '123456789012345678');
    expect(mocks.signIn).not.toHaveBeenCalled(); expect(mocks.jar.delete).toHaveBeenCalledWith('identity-discord');
  });
  it('does not auto-create or merge accounts during provider sign-in', async () => {
    mocks.challenge.mockResolvedValue({ tokenHash: digest(state), provider: 'DISCORD', intent: 'SIGN_IN', userId: null, browserHash: digest(browser), expiresAt: new Date(Date.now() + 60000), consumedAt: null });
    mocks.transaction.mockImplementation(async fn => fn({ identityChallenge: { updateMany: async () => ({ count: 1 }) }, externalIdentity: { findUnique: async () => null } }));
    const response = await GET(request(), params);
    expect(response.status).toBe(403); expect(mocks.signIn).not.toHaveBeenCalled(); expect(mocks.attach).not.toHaveBeenCalled();
  });
});
