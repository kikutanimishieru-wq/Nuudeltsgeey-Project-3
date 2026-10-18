import { beforeEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ identity: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireUser: async () => ({ id: 'user' }) }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: async (fn: any) => fn({ $queryRaw: vi.fn(), externalIdentity: { findUniqueOrThrow: mocks.identity, update: mocks.update }, auditEvent: { create: mocks.audit } }) } }));
import { POST } from '../app/api/identity/[provider]/revoke/route';
const context = { params: Promise.resolve({ provider: 'steam' }) };
const request = () => new Request('https://arena.example/api/identity/steam/revoke', { method: 'POST', headers: { origin: 'https://arena.example' } });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('APP_URL', 'https://arena.example'); });
describe('self-reported loss cannot release administrator holds', () => {
  it.each([
    { administrativeHoldAt: new Date(), revokedAt: new Date(), revocationKind: 'ADMIN' },
    { administrativeHoldAt: null, revokedAt: new Date(), revocationKind: null },
  ])('preserves active/legacy review markers', async identity => {
    mocks.identity.mockResolvedValue(identity);
    expect((await POST(request(), context)).status).toBe(200);
    const data = mocks.update.mock.calls[0][0].data;
    expect(data.revokedAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty('administrativeHoldAt'); expect(data).not.toHaveProperty('revocationKind');
  });
  it('marks ordinary self-reported loss explicitly for later fresh proof', async () => {
    mocks.identity.mockResolvedValue({ administrativeHoldAt: null, revokedAt: null, revocationKind: null });
    expect((await POST(request(), context)).status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data.revocationKind).toBe('SELF');
  });
});
