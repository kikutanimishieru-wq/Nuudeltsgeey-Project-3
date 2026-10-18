import { assertCurrentPermission } from '@/lib/transaction-authority';
import { assertCompetitiveIdentity } from '@/lib/permissions';
import { SecurityError } from '@/lib/security-error';
import { lockIdentityUser } from '@/lib/identity';
import { secureMutation } from '@/lib/secure-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authError, requireAdmin } from '@/lib/session';
import { writeAudit } from '@/lib/audit';

export const POST = secureMutation(async function POST(_: Request, { params }: { params: Promise<{ nmdId: string }> }) {
  try {
    const admin = await requireAdmin();
    const { nmdId } = await params;
    const player = await prisma.$transaction(async tx => {
      await assertCurrentPermission(tx, admin.id, 'ADMIN_DASHBOARD');
      const target = await tx.user.findUnique({ where: { publicNmdId: nmdId }, include: { externalIdentities: true } });
      if (!target) throw new SecurityError('PLAYER_NOT_FOUND', 404);
      if (target.id === admin.id) throw new SecurityError('CONFLICT_OF_INTEREST');
      await lockIdentityUser(tx, target.id);
      const current = await tx.user.findUniqueOrThrow({ where: { id: target.id }, include: { externalIdentities: true } });
      if (!['CREATED', 'UNVERIFIED', 'VERIFIED', 'ACTIVE'].includes(current.accountStatus)) throw new SecurityError('ACCOUNT_REVIEW_REQUIRED', 409);
      assertCompetitiveIdentity({ ...current, accountStatus: 'ACTIVE' });
      const changed = await tx.user.update({ where: { publicNmdId: nmdId }, data: { accountStatus: 'ACTIVE' }, select: { id: true, publicNmdId: true, accountStatus: true } });
      await writeAudit(tx, { actorId: admin.id, action: 'PLAYER_VERIFIED', entityType: 'User', entityId: changed.id, metadata: { publicNmdId: changed.publicNmdId } });
      return changed;
    });
    return NextResponse.json({ player });
  } catch (error) {
    const result = authError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
});
