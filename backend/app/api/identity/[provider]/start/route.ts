import { assertRevocableLinkingAvailable } from '@/lib/link-authorization';
import { assertDiscordSignIn } from '@/lib/discord-accounts';
import { verifyLinkPassword } from '@/lib/link-authentication';
import { lockIdentityUser } from '@/lib/identity';
import { NextResponse } from 'next/server';
import { secureMutation } from '@/lib/secure-route';
import { requireUser } from '@/lib/session';
import { applicationOrigin } from '@/lib/request-security';
import { parseProvider, providerAuthorization } from '@/lib/identity-providers';
import { digest, identityCookie, newSecret } from '@/lib/identity';
import { prisma } from '@/lib/prisma';
import { enforceRateLimit } from '@/lib/rate-limit';
import { writeAudit } from '@/lib/audit';
import { SecurityError } from '@/lib/security-error';

export const POST = secureMutation(async (request: Request, { params }: { params: Promise<{ provider: string }> }) => {
  const provider = parseProvider((await params).provider);
  const input = await request.json().catch(() => null);
  if (!input || !['LINK', 'SIGN_IN'].includes(input.intent)) throw new SecurityError('INVALID_IDENTITY_INTENT', 400);
  if (input.intent === 'LINK') assertRevocableLinkingAvailable();
  if (input.intent === 'SIGN_IN') assertDiscordSignIn(provider);
  const user = input.intent === 'LINK' ? await requireUser() : null;
  if (user) await enforceRateLimit('identity-link', user.id, 10, 600);
  const proof = user ? await verifyLinkPassword(user.id, input.password) : null;
  const state = newSecret(); const browser = newSecret();
  const callback = `${applicationOrigin()}/api/identity/${provider.toLowerCase()}/callback`;
  const url = providerAuthorization(provider, callback, state);
  await prisma.$transaction(async tx => {
    if (user && proof) {
      await lockIdentityUser(tx, user.id);
      const current = await tx.user.findUnique({ where: { id: user.id }, select: { passwordHash: true, accountStatus: true } });
      if (!current || current.passwordHash !== proof.passwordHash || ['SUSPENDED', 'BADGE_REVOKED'].includes(current.accountStatus)) throw new SecurityError('FRESH_AUTHENTICATION_REQUIRED', 401);
    }
    await tx.identityChallenge.create({ data: { tokenHash: digest(state), provider, intent: input.intent,
      browserHash: digest(browser), reauthenticatedAt: proof?.authenticatedAt, userId: user?.id, expiresAt: new Date(Date.now() + (user ? 300_000 : 600_000)) } });
    if (user) await writeAudit(tx, { actorId: user.id, action: 'IDENTITY_LINK_STARTED', entityType: 'User', entityId: user.id, metadata: { provider } });
  });
  const response = NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(identityCookie(provider), browser, { httpOnly: true, sameSite: 'lax', secure: applicationOrigin().startsWith('https:'), path: '/', maxAge: 600 });
  return response;
});
