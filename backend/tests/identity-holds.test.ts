import { describe, it, expect, vi } from 'vitest';
vi.mock('../lib/prisma', () => ({ prisma: {} }));
import { attachVerifiedIdentity, hasAdministrativeHold } from '../lib/identity';
import { assertCompetitiveIdentity } from '../lib/permissions';
function transaction(identity: object) { return { $queryRaw: vi.fn(), user: { findUnique: async () => ({ accountStatus: 'ACTIVE' }) },
  externalIdentity: { findUnique: vi.fn().mockResolvedValue(identity), update: vi.fn() }, auditEvent: { create: vi.fn() } }; }
const subject = { id: 'link', userId: 'user', providerAccountId: 'subject', verifiedAt: new Date() };
describe('administrative identity holds', () => {
  it.each([
    { administrativeHoldAt: new Date(), revokedAt: new Date(), revocationKind: 'ADMIN' },
    { administrativeHoldAt: new Date(), revokedAt: null },
    { revokedAt: new Date(), revocationKind: null },
  ])('rejects reverification for active or legacy unclassified holds', async hold => {
    const tx = transaction({ ...subject, ...hold });
    await expect(attachVerifiedIdentity(tx as never, 'user', 'STEAM', 'subject')).rejects.toThrow('IDENTITY_SECURITY_HOLD');
    expect(tx.externalIdentity.update).not.toHaveBeenCalled();
  });
  it.each(['SELF', 'ADMIN_CLEARED'])('allows fresh proof after %s revocation without changing a hold', async revocationKind => {
    const tx = transaction({ ...subject, revokedAt: new Date(), administrativeHoldAt: null, revocationKind });
    await attachVerifiedIdentity(tx as never, 'user', 'STEAM', 'subject');
    const data = tx.externalIdentity.update.mock.calls[0][0].data;
    expect(data.revokedAt).toBeNull(); expect(data).not.toHaveProperty('administrativeHoldAt');
  });
  it('blocks protected competition even if a held identity has no revoked timestamp', () => {
    const links = ['STEAM', 'DISCORD'].map(provider => ({ provider, verifiedAt: new Date(), revokedAt: null, administrativeHoldAt: provider === 'STEAM' ? new Date() : null }));
    expect(() => assertCompetitiveIdentity({ accountStatus: 'ACTIVE', externalIdentities: links })).toThrow('COMPETITIVE_IDENTITY_REQUIRED');
    expect(hasAdministrativeHold(links[0])).toBe(true);
  });
});
