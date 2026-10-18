import { hasAdministrativeHold } from './identity-policy';
import { SecurityError } from './security-error';

export type Role = 'PLAYER' | 'REFEREE' | 'ADMIN' | 'SUPER_ADMIN';
export type Permission = 'ADMIN_DASHBOARD' | 'IDENTITY_REVIEW' | 'REVIEW_MINOR' | 'REVIEW_SERIOUS' | 'ROLE_MANAGEMENT';
const permissions: Record<Permission, readonly Role[]> = {
  ROLE_MANAGEMENT: ['SUPER_ADMIN'],
  ADMIN_DASHBOARD: ['ADMIN', 'SUPER_ADMIN'],
  IDENTITY_REVIEW: ['ADMIN', 'SUPER_ADMIN'],
  REVIEW_MINOR: ['REFEREE', 'ADMIN', 'SUPER_ADMIN'],
  REVIEW_SERIOUS: ['ADMIN', 'SUPER_ADMIN'],
};
export function assertPermission(user: { role: string; accountStatus: string }, permission: Permission) {
  if (user.accountStatus !== 'ACTIVE' || !permissions[permission].includes(user.role as Role)) throw new SecurityError('FORBIDDEN');
}
export function assertCompetitiveIdentity(user: { accountStatus: string; externalIdentities: Array<{ provider: string; verifiedAt: Date | null; revokedAt: Date | null; administrativeHoldAt?: Date | null; revocationKind?: string | null }> }) {
  if (!['ACTIVE', 'VERIFIED'].includes(user.accountStatus) || !['STEAM', 'DISCORD'].every(provider =>
    user.externalIdentities.some(link => link.provider === provider && link.verifiedAt && !link.revokedAt && !hasAdministrativeHold(link)))) {
    throw new SecurityError('COMPETITIVE_IDENTITY_REQUIRED');
  }
}
export function assertIndependent(reviewerId: string, involvedUserIds: string[]) {
  if (involvedUserIds.includes(reviewerId)) throw new SecurityError('CONFLICT_OF_INTEREST');
}
