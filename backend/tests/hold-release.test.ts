import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ actor: vi.fn(), user: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/session', () => ({ requirePermission: mocks.actor }));
vi.mock('@/lib/transaction-authority', () => ({ assertCurrentPermission: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: async (fn: any) => fn({ $queryRaw: vi.fn(), user: { findUnique: mocks.user }, externalIdentity: { update: mocks.update }, auditEvent: { create: mocks.audit } }) } }));
import { POST } from '../app/api/admin/identities/[nmdId]/release-hold/route';
import { SecurityError } from '../lib/security-error';
const context = { params: Promise.resolve({ nmdId: 'NMD-000001' }) };
const request = (input: object) => new Request('https://arena.example/api/admin/identities/NMD-000001/release-hold', { method: 'POST', headers: { origin: 'https://arena.example', 'content-type': 'application/json' }, body: JSON.stringify(input) });
const input = { provider: 'STEAM', reason: 'Independently reviewed account recovery', reference: 'CASE-001' };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('APP_URL', 'https://arena.example'); mocks.actor.mockResolvedValue({ id: 'admin' }); mocks.user.mockResolvedValue({ id: 'target' }); });
describe('explicit administrative hold release', () => {
  it('requires authorized administration and rejects self-release', async () => {
    mocks.actor.mockRejectedValueOnce(new SecurityError('FORBIDDEN'));
    expect((await POST(request(input), context)).status).toBe(403);
    mocks.user.mockResolvedValue({ id: 'admin' });
    expect((await POST(request(input), context)).status).toBe(403); expect(mocks.update).not.toHaveBeenCalled();
  });
  it('requires documented review and never marks provider verification complete', async () => {
    expect((await POST(request({ provider: 'STEAM' }), context)).status).toBe(400);
    expect((await POST(request(input), context)).status).toBe(200);
    const data = mocks.update.mock.calls[0][0].data;
    expect(data.administrativeHoldAt).toBeNull(); expect(data.revokedAt).toBeInstanceOf(Date); expect(data.revocationKind).toBe('ADMIN_CLEARED');
    expect(data).not.toHaveProperty('verifiedAt'); expect(mocks.audit.mock.calls[0][0].data.action).toBe('IDENTITY_SECURITY_HOLD_RELEASED');
  });
});
