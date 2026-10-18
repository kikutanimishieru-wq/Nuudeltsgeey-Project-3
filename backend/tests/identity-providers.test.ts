import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseProvider, providerAuthorization, steamEndpoint, verifySteam, verifyDiscord } from '../lib/identity-providers';
const returnTo = 'https://arena.example/api/identity/steam/callback?state=opaque';
const now = new Date('2026-10-16T10:00:00Z');
function assertion() {
  return new URLSearchParams({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res',
    'openid.op_endpoint': steamEndpoint, 'openid.return_to': returnTo,
    'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561198000000001',
    'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000001',
    'openid.response_nonce': '2026-10-16T10:00:00Zunique', 'openid.assoc_handle': 'association', 'openid.sig': 'signature',
    'openid.signed': 'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle' });
}
afterEach(() => vi.unstubAllEnvs());
describe('provider verification', () => {
  it('uses a fixed Steam endpoint and exact state-bound return URL', () => {
    const url = new URL(providerAuthorization('STEAM', 'https://arena.example/api/identity/steam/callback', 'opaque'));
    expect(url.origin).toBe('https://steamcommunity.com');
    expect(url.searchParams.get('openid.return_to')).toBe(returnTo);
    expect(() => parseProvider('attacker')).toThrow('UNKNOWN_PROVIDER');
  });
  it('performs direct server-side Steam signature validation', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n'));
    const result = await verifySteam(assertion(), returnTo, fetcher, now);
    expect(result.subject).toBe('76561198000000001');
    const [endpoint, options] = fetcher.mock.calls[0];
    expect(endpoint).toBe(steamEndpoint);
    expect(options.body.get('openid.mode')).toBe('check_authentication');
    expect(options.redirect).toBe('error');
  });
  it.each([
    ['openid.op_endpoint', 'https://attacker.example/'], ['openid.return_to', 'https://attacker.example/'],
    ['openid.claimed_id', 'http://steamcommunity.com/openid/id/76561198000000001'],
    ['openid.signed', 'identity,claimed_id'], ['openid.response_nonce', '2026-10-15T10:00:00Zold'],
  ])('rejects invalid %s before network access', async (key, value) => {
    const input = assertion(); input.set(key, value); const fetcher = vi.fn();
    await expect(verifySteam(input, returnTo, fetcher, now)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects duplicate parameters and invalid signatures', async () => {
    const input = assertion(); input.append('openid.identity', 'different');
    await expect(verifySteam(input, returnTo, vi.fn(), now)).rejects.toThrow();
    await expect(verifySteam(assertion(), returnTo, vi.fn().mockResolvedValue(new Response('is_valid:false')), now)).rejects.toThrow('PROVIDER_VERIFICATION_FAILED');
  });
  it('requests only Discord identify and exchanges the code server-side', async () => {
    vi.stubEnv('DISCORD_CLIENT_ID', 'client'); vi.stubEnv('DISCORD_CLIENT_SECRET', 'secret');
    const callback = 'https://arena.example/api/identity/discord/callback';
    const url = new URL(providerAuthorization('DISCORD', callback, 'opaque'));
    expect(url.searchParams.get('scope')).toBe('identify'); expect(url.searchParams.get('state')).toBe('opaque');
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'private', token_type: 'Bearer', scope: 'identify' }))
      .mockResolvedValueOnce(Response.json({ id: '123456789012345678', email: 'not-used', verified: false }));
    expect(await verifyDiscord('code', callback, fetcher)).toBe('123456789012345678');
    expect(fetcher.mock.calls[0][1].body.get('client_secret')).toBe('secret');
    expect(fetcher.mock.calls[1][0]).toBe('https://discord.com/api/v10/users/@me');
  });
  it('fails closed for missing Discord configuration and bot accounts', async () => {
    vi.stubEnv('DISCORD_CLIENT_ID', ''); vi.stubEnv('DISCORD_CLIENT_SECRET', '');
    expect(() => providerAuthorization('DISCORD', returnTo, 'state')).toThrow('DISCORD_CONFIGURATION_REQUIRED');
    vi.stubEnv('DISCORD_CLIENT_ID', 'client'); vi.stubEnv('DISCORD_CLIENT_SECRET', 'secret');
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'private', token_type: 'Bearer', scope: 'identify' }))
      .mockResolvedValueOnce(Response.json({ id: '123456789012345678', bot: true }));
    await expect(verifyDiscord('code', returnTo, fetcher)).rejects.toThrow('INVALID_PROVIDER_RESPONSE');
  });
});
