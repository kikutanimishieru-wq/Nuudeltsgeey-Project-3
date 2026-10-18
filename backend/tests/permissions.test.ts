import { describe, it, expect } from 'vitest';
import { assertCompetitiveIdentity, assertPermission, assertIndependent } from '../lib/permissions';
const verified = (provider: string): { provider: string; verifiedAt: Date; revokedAt: Date | null } => ({ provider, verifiedAt: new Date(), revokedAt: null });
describe('Phase 2 authority', () => {
  it.each(['STEAM', 'DISCORD'])('requires both providers even when %s is verified', provider => {
    expect(() => assertCompetitiveIdentity({ accountStatus: 'ACTIVE', externalIdentities: [verified(provider)] })).toThrow('COMPETITIVE_IDENTITY_REQUIRED');
  });
  it('accepts both verified providers and rejects a revoked one without altering the account', () => {
    const user = { accountStatus: 'ACTIVE', externalIdentities: [verified('STEAM'), verified('DISCORD')] };
    expect(() => assertCompetitiveIdentity(user)).not.toThrow();
    user.externalIdentities[0] = { ...verified('STEAM'), revokedAt: new Date() };
    expect(() => assertCompetitiveIdentity(user)).toThrow();
    expect(user.accountStatus).toBe('ACTIVE');
  });
  it.each(['UNVERIFIED', 'UNDER_REVIEW', 'SUSPENDED', 'BADGE_REVOKED'])('blocks protected actions for %s', accountStatus => {
    expect(() => assertCompetitiveIdentity({ accountStatus, externalIdentities: [verified('STEAM'), verified('DISCORD')] })).toThrow();
  });
  it('permits referee minor review but not serious penalties, roles or admin reads', () => {
    const referee = { role: 'REFEREE', accountStatus: 'ACTIVE' };
    expect(() => assertPermission(referee, 'REVIEW_MINOR')).not.toThrow();
    for (const permission of ['ADMIN_DASHBOARD', 'REVIEW_SERIOUS', 'ROLE_MANAGEMENT'] as const) expect(() => assertPermission(referee, permission)).toThrow('FORBIDDEN');
  });
  it('reserves role management for active super administrators', () => {
    expect(() => assertPermission({ role: 'ADMIN', accountStatus: 'ACTIVE' }, 'ROLE_MANAGEMENT')).toThrow();
    expect(() => assertPermission({ role: 'SUPER_ADMIN', accountStatus: 'ACTIVE' }, 'ROLE_MANAGEMENT')).not.toThrow();
    expect(() => assertPermission({ role: 'SUPER_ADMIN', accountStatus: 'SUSPENDED' }, 'ROLE_MANAGEMENT')).toThrow();
  });
  it('rejects involved reviewers without administrator bypass', () => {
    expect(() => assertIndependent('reviewer', ['reviewer'])).toThrow('CONFLICT_OF_INTEREST');
    expect(() => assertIndependent('reviewer', ['other'])).not.toThrow();
  });
});
