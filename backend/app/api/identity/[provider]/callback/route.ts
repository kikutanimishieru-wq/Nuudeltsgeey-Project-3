import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth, signIn } from '@/auth';
import { applicationOrigin, clientRateKey } from '@/lib/request-security';
import { parseProvider, verifySteam, verifyDiscord } from '@/lib/identity-providers';
import { assertBrowserSecret, assertChallenge, hasAdministrativeHold, attachVerifiedIdentity, digest, identityCookie, newSecret } from '@/lib/identity';
import { enforceRateLimit } from '@/lib/rate-limit';
import { prisma } from '@/lib/prisma';
import { safeError, SecurityError } from '@/lib/security-error';

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const provider = parseProvider((await params).provider);
    await enforceRateLimit('identity-callback', clientRateKey(request), 30);
    const url = new URL(request.url); const state = url.searchParams.get('state') ?? '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || url.searchParams.getAll('state').length !== 1) throw new SecurityError('INVALID_IDENTITY_STATE', 400);
    const challenge = await prisma.identityChallenge.findUnique({ where: { tokenHash: digest(state) } });
    assertChallenge(challenge, provider);
    if (!challenge) throw new SecurityError('INVALID_IDENTITY_STATE', 400);
    const jar = await cookies(); const browser = jar.get(identityCookie(provider))?.value;
    assertBrowserSecret(browser, challenge.browserHash);
    const session = challenge.intent === 'LINK' ? await auth() : null;
    if (challenge.intent === 'LINK' && (!session?.user?.id || session.user.id !== challenge.userId)) throw new SecurityError('LINK_SESSION_CHANGED');
    const callback = `${applicationOrigin()}/api/identity/${provider.toLowerCase()}/callback`;
    let subject: string; let nonce: string | undefined;
    if (provider === 'STEAM') {
      const expected = new URL(callback); expected.searchParams.set('state', state);
      const proof = await verifySteam(url.searchParams, expected.href); subject = proof.subject; nonce = proof.nonce;
    } else {
      if (url.searchParams.getAll('code').length !== 1) throw new SecurityError('INVALID_PROVIDER_RESPONSE', 400);
      subject = await verifyDiscord(url.searchParams.get('code') ?? '', callback);
    }
    const ticket = newSecret();
    await prisma.$transaction(async tx => {
      assertChallenge(challenge, provider);
      const consumed = await tx.identityChallenge.updateMany({ where: { tokenHash: challenge.tokenHash, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw new SecurityError('IDENTITY_STATE_REPLAY', 409);
      if (nonce) await tx.steamAssertionNonce.create({ data: { nonceHash: digest(nonce), expiresAt: new Date(Date.now() + 600_000) } });
      if (challenge.intent === 'LINK') {
        await attachVerifiedIdentity(tx, challenge.userId!, provider, subject);
      } else {
        const link = await tx.externalIdentity.findUnique({ where: { provider_providerAccountId: { provider, providerAccountId: subject } } });
        if (!link || link.revokedAt || hasAdministrativeHold(link)) throw new SecurityError('LINK_EXISTING_ACCOUNT_FIRST', 403);
        await attachVerifiedIdentity(tx, link.userId, provider, subject);
        await tx.identityLoginGrant.create({ data: { tokenHash: digest(ticket), userId: link.userId, provider,
          browserHash: challenge.browserHash, expiresAt: new Date(Date.now() + 60_000) } });
      }
    });
    if (challenge.intent === 'SIGN_IN') await signIn('linked-identity', { ticket, provider, redirect: false });
    jar.delete(identityCookie(provider));
    return NextResponse.redirect(new URL('/identity', applicationOrigin()), { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch (error) {
    const result = safeError(error);
    // No exception object, provider response, subject, code or token is logged.
    return NextResponse.json({ error: result.error }, { status: result.status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  }
}
