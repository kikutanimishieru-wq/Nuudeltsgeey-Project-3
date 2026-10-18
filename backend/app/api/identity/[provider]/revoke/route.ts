import { NextResponse } from 'next/server';
import { secureMutation } from '@/lib/secure-route';
import { requireUser } from '@/lib/session';
import { parseProvider } from '@/lib/identity-providers';
import { lockIdentityUser } from '@/lib/identity';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
export const POST = secureMutation(async (_: Request, { params }: { params: Promise<{ provider: string }> }) => {
  const user = await requireUser(); const provider = parseProvider((await params).provider);
  await prisma.$transaction(async tx => {
    await lockIdentityUser(tx, user.id);
    const current = await tx.externalIdentity.findUniqueOrThrow({ where: { userId_provider: { userId: user.id, provider } } });
    const knownSelfRevocation = !current.administrativeHoldAt && (!current.revokedAt || ['SELF', 'ADMIN_CLEARED'].includes(current.revocationKind ?? ''));
    await tx.externalIdentity.update({ where: { userId_provider: { userId: user.id, provider } }, data: { revokedAt: new Date(), ...(knownSelfRevocation ? { revocationKind: 'SELF' } : {}) } });
    await writeAudit(tx, { actorId: user.id, action: 'IDENTITY_VERIFICATION_REVOKED', entityType: 'User', entityId: user.id, metadata: { provider, selfReported: true } });
  });
  return NextResponse.json({ status: 'REVERIFICATION_REQUIRED' });
});
