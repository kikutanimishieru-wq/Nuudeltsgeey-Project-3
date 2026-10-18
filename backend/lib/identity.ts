import { hasAdministrativeHold } from './identity-policy';
export { hasAdministrativeHold } from './identity-policy';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { SecurityError } from './security-error';
import { writeAudit } from './audit';
import type { Provider } from './identity-providers';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const newSecret = () => randomBytes(32).toString('base64url');
export const identityCookie = (provider: Provider) => `identity-${provider.toLowerCase()}`;
export function assertBrowserSecret(secret: string | undefined, expectedHash: string) {
  const actual = Buffer.from(digest(secret ?? ''));
  const expected = Buffer.from(expectedHash);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new SecurityError('INVALID_IDENTITY_STATE', 400);
}
export function assertChallenge(challenge: { provider: string; intent: string; expiresAt: Date; consumedAt: Date | null; reauthenticatedAt?: Date | null } | null, provider: Provider, now = new Date()) {
  if (!challenge || challenge.provider !== provider || !['LINK', 'SIGN_IN'].includes(challenge.intent) || challenge.consumedAt || challenge.expiresAt <= now) {
    throw new SecurityError('INVALID_IDENTITY_STATE', 400);
  }
  if (challenge.intent === 'LINK') assertFreshLinkAuthentication(challenge.reauthenticatedAt, now);
}
export function assertFreshLinkAuthentication(authenticatedAt: Date | null | undefined, now = new Date()) {
  const age = authenticatedAt ? now.getTime() - authenticatedAt.getTime() : NaN;
  if (!Number.isFinite(age) || age < 0 || age > 300_000) throw new SecurityError('FRESH_AUTHENTICATION_REQUIRED', 401);
}
export async function lockIdentityUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
}
export async function attachVerifiedIdentity(tx: Prisma.TransactionClient, userId: string, provider: Provider, subject: string) {
  await lockIdentityUser(tx, userId);
  const user = await tx.user.findUnique({ where: { id: userId }, select: { accountStatus: true } });
  if (!user || ['SUSPENDED', 'BADGE_REVOKED'].includes(user.accountStatus)) throw new SecurityError('FORBIDDEN');
  const existing = await tx.externalIdentity.findUnique({ where: { userId_provider: { userId, provider } } });
  const claimed = await tx.externalIdentity.findUnique({ where: { provider_providerAccountId: { provider, providerAccountId: subject } } });
  if ((existing && existing.providerAccountId !== subject) || (claimed && claimed.userId !== userId)) throw new SecurityError('IDENTITY_REQUIRES_REVIEW', 409);
  if (existing && hasAdministrativeHold(existing)) throw new SecurityError('IDENTITY_SECURITY_HOLD', 403);
  if (existing) {
    await tx.externalIdentity.update({ where: { id: existing.id }, data: { verifiedAt: new Date(), revokedAt: null, revocationKind: null } });
  } else {
    await tx.externalIdentity.create({ data: { userId, provider, providerAccountId: subject, verifiedAt: new Date() } });
  }
  await writeAudit(tx, { actorId: userId, action: 'IDENTITY_VERIFIED', entityType: 'User', entityId: userId, metadata: { provider, reverified: Boolean(existing) } });
}
export async function consumeLoginGrant(ticket: string, browserSecret: string | undefined) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
  return prisma.$transaction(async tx => {
    const grant = await tx.identityLoginGrant.findUnique({ where: { tokenHash: digest(ticket) } });
    if (!grant || grant.consumedAt || grant.expiresAt <= new Date()) return null;
    assertBrowserSecret(browserSecret, grant.browserHash);
    const claimed = await tx.identityLoginGrant.updateMany({ where: { tokenHash: grant.tokenHash, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (claimed.count !== 1) return null;
    await lockIdentityUser(tx, grant.userId);
    const user = await tx.user.findUnique({ where: { id: grant.userId }, select: { id: true, email: true, role: true, accountStatus: true, publicNmdId: true } });
    const identity = await tx.externalIdentity.findUnique({ where: { userId_provider: { userId: grant.userId, provider: grant.provider } } });
    if (!user || ['SUSPENDED', 'BADGE_REVOKED'].includes(user.accountStatus) || !identity || identity.revokedAt || hasAdministrativeHold(identity)) return null;
    await writeAudit(tx, { actorId: user.id, action: 'PROVIDER_SIGN_IN', entityType: 'User', entityId: user.id, metadata: { provider: grant.provider } });
    return user;
  });
}
