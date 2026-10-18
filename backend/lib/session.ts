import { auth } from '@/auth';
import { prisma } from './prisma';
import { assertCompetitiveIdentity, assertPermission, type Permission } from './permissions';
import { enforceRateLimit } from './rate-limit';
export { safeError as authError } from './security-error';

export async function requireUser() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error('UNAUTHORIZED');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: {
    id: true, role: true, accountStatus: true, publicNmdId: true,
    profile: { select: { id: true } },
    externalIdentities: { select: { provider: true, verifiedAt: true, revokedAt: true, administrativeHoldAt: true, revocationKind: true } },
  } });
  if (!user || ['SUSPENDED', 'BADGE_REVOKED'].includes(user.accountStatus)) throw new Error('FORBIDDEN');
  return user;
}
export async function requirePermission(permission: Permission) {
  const user = await requireUser();
  assertPermission(user, permission);
  await enforceRateLimit('privileged-actor', user.id, 60);
  return user;
}
export async function requireAdmin() { return requirePermission('ADMIN_DASHBOARD'); }
export async function requireCompetitiveUser() {
  const user = await requireUser();
  assertCompetitiveIdentity(user);
  await enforceRateLimit('competitive-actor', user.id, 30);
  return user;
}
