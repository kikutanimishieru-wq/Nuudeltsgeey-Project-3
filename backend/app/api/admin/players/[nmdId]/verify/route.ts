import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authError, requireAdmin } from '@/lib/session';
import { writeAudit } from '@/lib/audit';

export async function POST(_: Request, { params }: { params: Promise<{ nmdId: string }> }) {
  try {
    const admin = await requireAdmin();
    const { nmdId } = await params;
    const player = await prisma.user.update({ where: { publicNmdId: nmdId }, data: { accountStatus: 'ACTIVE' }, select: { id: true, publicNmdId: true, accountStatus: true } });
    await writeAudit({ actorId: admin.id, action: 'PLAYER_VERIFIED', entityType: 'User', entityId: player.id, metadata: { publicNmdId: player.publicNmdId } });
    return NextResponse.json({ player });
  } catch (error) {
    const result = authError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
