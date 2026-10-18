import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../lib/prisma', () => ({ prisma: { $transaction: vi.fn() } }));
import { prisma } from '../lib/prisma';
import { assertBrowserSecret, assertChallenge, attachVerifiedIdentity, consumeLoginGrant, digest, newSecret } from '../lib/identity';
const tx = () => ({ $queryRaw: vi.fn(), user: { findUnique: vi.fn().mockResolvedValue({ id: 'user', accountStatus: 'ACTIVE' }) },
  externalIdentity: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() }, auditEvent: { create: vi.fn() },
  identityLoginGrant: { findUnique: vi.fn(), updateMany: vi.fn() } });
beforeEach(() => vi.clearAllMocks());
describe('identity state and uniqueness', () => {
  it('requires an unexpired unconsumed same-provider challenge and browser binding', () => {
    const challenge = { provider: 'STEAM', intent: 'LINK', reauthenticatedAt: new Date(), consumedAt: null, expiresAt: new Date(Date.now() + 60000) };
    expect(() => assertChallenge(challenge, 'STEAM')).not.toThrow();
    expect(() => assertChallenge({ ...challenge, consumedAt: new Date() }, 'STEAM')).toThrow();
    expect(() => assertChallenge({ ...challenge, expiresAt: new Date(0) }, 'STEAM')).toThrow();
    expect(() => assertChallenge(challenge, 'DISCORD')).toThrow();
    expect(() => assertBrowserSecret('browser', digest('browser'))).not.toThrow();
    expect(() => assertBrowserSecret('attacker', digest('browser'))).toThrow();
    expect(() => assertBrowserSecret(undefined, digest('browser'))).toThrow();
  });
  it('rejects provider ownership conflicts without moving or overwriting identity', async () => {
    const db = tx(); db.externalIdentity.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ userId: 'other' });
    await expect(attachVerifiedIdentity(db as never, 'user', 'STEAM', 'subject')).rejects.toThrow('IDENTITY_REQUIRES_REVIEW');
    expect(db.externalIdentity.create).not.toHaveBeenCalled(); expect(db.externalIdentity.update).not.toHaveBeenCalled();
  });
  it('rejects replacing the account slot with another provider identity', async () => {
    const db = tx(); db.externalIdentity.findUnique.mockResolvedValueOnce({ providerAccountId: 'old' }).mockResolvedValueOnce(null);
    await expect(attachVerifiedIdentity(db as never, 'user', 'STEAM', 'new')).rejects.toThrow('IDENTITY_REQUIRES_REVIEW');
  });
  it('does not promote account status or expose provider subjects in audit metadata', async () => {
    const db = tx(); db.externalIdentity.findUnique.mockResolvedValue(null);
    await attachVerifiedIdentity(db as never, 'user', 'STEAM', 'private-subject');
    expect(db.auditEvent.create).toHaveBeenCalledOnce();
    expect(JSON.stringify(db.auditEvent.create.mock.calls)).not.toContain('private-subject');
    expect(db.externalIdentity.create).toHaveBeenCalledOnce();
  });
  it('propagates audit failure so the caller transaction rolls back', async () => {
    const db = tx(); db.externalIdentity.findUnique.mockResolvedValue(null); db.auditEvent.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(attachVerifiedIdentity(db as never, 'user', 'STEAM', 'subject')).rejects.toThrow('audit unavailable');
  });
  it('rejects replayed login tickets even if two readers saw the same grant', async () => {
    const db = tx(); const ticket = newSecret();
    db.identityLoginGrant.findUnique.mockResolvedValue({ tokenHash: digest(ticket), provider: 'STEAM', userId: 'user', browserHash: digest('browser'), expiresAt: new Date(Date.now() + 60000), consumedAt: null });
    db.identityLoginGrant.updateMany.mockResolvedValue({ count: 0 });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(db));
    expect(await consumeLoginGrant(ticket, 'browser')).toBeNull();
    expect(db.auditEvent.create).not.toHaveBeenCalled();
  });
});
