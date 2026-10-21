import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), signIn: vi.fn(), challenge: vi.fn(), transaction: vi.fn(), verifySteam: vi.fn(), verifyDiscord: vi.fn(),
  resolve: vi.fn(), refresh: vi.fn(), attach: vi.fn(), jar: { get: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/lib/discord-accounts', async original => ({ ...await original<object>(), resolveDiscordAccount:mocks.resolve, refreshCompetitiveStatus:mocks.refresh }));
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
  it('blocks legacy linking challenges before provider access or attachment',async()=>{
    expect((await GET(request(),params)).status).toBe(503);
    expect(mocks.verifyDiscord).not.toHaveBeenCalled();expect(mocks.transaction).not.toHaveBeenCalled();expect(mocks.attach).not.toHaveBeenCalled();
  });
  it('replayed Discord callback cannot provision or issue another grant',async()=>{
    mocks.challenge.mockResolvedValue({tokenHash:digest(state),provider:'DISCORD',intent:'SIGN_IN',browserHash:digest(browser),expiresAt:new Date(Date.now()+60000),consumedAt:null});
    const create=vi.fn();mocks.transaction.mockImplementation(async fn=>fn({identityChallenge:{updateMany:async()=>({count:0})},identityLoginGrant:{create}}));
    expect((await GET(request(),params)).status).toBe(409);expect(mocks.resolve).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it('resolves verified Discord subject transactionally and issues a browser-bound grant', async () => {
    mocks.challenge.mockResolvedValue({ tokenHash:digest(state),provider:'DISCORD',intent:'SIGN_IN',userId:null,browserHash:digest(browser),expiresAt:new Date(Date.now()+60000),consumedAt:null });
    mocks.resolve.mockResolvedValue('resolved-account');
    const create=vi.fn();
    mocks.transaction.mockImplementation(async fn=>fn({identityChallenge:{updateMany:async()=>({count:1})},identityLoginGrant:{create}}));
    const response=await GET(request(),params);
    expect(response.status).toBe(307);expect(mocks.resolve).toHaveBeenCalledWith(expect.anything(),'123456789012345678');
    expect(create).toHaveBeenCalledWith({data:expect.objectContaining({userId:'resolved-account',provider:'DISCORD',browserHash:digest(browser)})});
    expect(mocks.signIn).toHaveBeenCalledWith('linked-identity',expect.objectContaining({provider:'DISCORD',redirect:false}));
  });
  it('rejects Steam sign-in callbacks before provider verification',async()=>{
    mocks.challenge.mockResolvedValue({provider:'STEAM',intent:'SIGN_IN',expiresAt:new Date(Date.now()+60000),consumedAt:null});
    expect((await GET(request(),{params:Promise.resolve({provider:'steam'})})).status).toBe(403);
    expect(mocks.verifySteam).not.toHaveBeenCalled();expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

it('session failure after callback commit reuses resolved account on a new OAuth attempt',async()=>{
 mocks.challenge.mockResolvedValue({tokenHash:digest(state),provider:'DISCORD',intent:'SIGN_IN',browserHash:digest(browser),expiresAt:new Date(Date.now()+60000),consumedAt:null});
 let committed=false;const accounts=new Map<string,string>();let creates=0;
 mocks.resolve.mockImplementation(async(_tx,subject)=>{if(!accounts.has(subject)){creates++;accounts.set(subject,'preserved-account');}return accounts.get(subject);});
 mocks.transaction.mockImplementation(async fn=>{const result=await fn({identityChallenge:{updateMany:async()=>({count:1})},identityLoginGrant:{create:vi.fn()}});committed=true;return result;});
 mocks.signIn.mockImplementationOnce(async()=>{expect(committed).toBe(true);throw Error('session failure');}).mockResolvedValue(undefined);
 expect((await GET(request(),params)).status).toBe(500);expect(accounts.size).toBe(1);
 const nextState=newSecret();mocks.challenge.mockResolvedValue({tokenHash:digest(nextState),provider:'DISCORD',intent:'SIGN_IN',browserHash:digest(browser),expiresAt:new Date(Date.now()+60000),consumedAt:null});
 expect((await GET(new Request(`https://arena.example/api/identity/discord/callback?state=${nextState}&code=second-code`),params)).status).toBe(307);expect(creates).toBe(1);
});
