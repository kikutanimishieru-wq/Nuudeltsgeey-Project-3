import { assertCurrentPermission } from '@/lib/transaction-authority';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { secureMutation } from '@/lib/secure-route';
import { writeAudit } from '@/lib/audit';
import { lockIdentityUser } from '@/lib/identity';
import { SecurityError } from '@/lib/security-error';
const schema = z.object({ provider: z.enum(['STEAM', 'DISCORD']), reason: z.string().trim().min(10).max(1000), reference: z.string().trim().min(3).max(200) }).strict();
export const POST = secureMutation(async (request: Request, { params }: { params: Promise<{ nmdId: string }> }) => {
  const admin = await requirePermission('IDENTITY_REVIEW');
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) throw new SecurityError('INVALID_IDENTITY_REVIEW', 400);
  const { nmdId } = await params;
  await prisma.$transaction(async tx => {
      await assertCurrentPermission(tx, admin.id, 'IDENTITY_REVIEW');
    const target = await tx.user.findUnique({ where: { publicNmdId: nmdId }, select: { id: true } });
    if (!target) throw new SecurityError('PLAYER_NOT_FOUND', 404);
    if (target.id === admin.id) throw new SecurityError('CONFLICT_OF_INTEREST');
    await lockIdentityUser(tx, target.id);
    await tx.externalIdentity.update({ where: { userId_provider: { userId: target.id, provider: input.data.provider } }, data: { revokedAt: new Date(), administrativeHoldAt: new Date(), revocationKind: 'ADMIN' } });
    // Reason/reference are private audit metadata, never returned by public profile queries.
    await writeAudit(tx, { actorId: admin.id, action: 'IDENTITY_SECURITY_HOLD', entityType: 'User', entityId: target.id,
      metadata: { provider: input.data.provider, reason: input.data.reason, reference: input.data.reference } });
  });
  return NextResponse.json({ status: 'ADMINISTRATIVE_SECURITY_HOLD' });
});
