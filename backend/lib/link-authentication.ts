import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import { enforceRateLimit } from './rate-limit';
import { SecurityError } from './security-error';
export async function verifyLinkPassword(userId: string, password: unknown) {
  await enforceRateLimit('link-reauthentication', userId, 8, 600);
  if (typeof password !== 'string' || password.length < 1 || password.length > 128) throw new SecurityError('FRESH_AUTHENTICATION_REQUIRED', 401);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true, accountStatus: true } });
  if (!user || ['SUSPENDED', 'BADGE_REVOKED'].includes(user.accountStatus) || typeof user.passwordHash !== 'string' || !user.passwordHash || !await bcrypt.compare(password, user.passwordHash)) throw new SecurityError('FRESH_AUTHENTICATION_REQUIRED', 401);
  // Private proof used only inside the server transaction to detect concurrent password changes.
  return { authenticatedAt: new Date(), passwordHash: user.passwordHash };
}
