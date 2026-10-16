import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authError, requireAdmin } from '@/lib/session';
import { writeAudit } from '@/lib/audit';

const schema = z.object({ reason: z.string().trim().min(3).max(1000), endsAt: z.string().datetime().optional() });

export async function POST(request: Request, { params }: { params: Promise<{ nmdId: string }> }) {
  try {
    const admin = await requireAdmin();
    const input = schema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: 'INVALID_SUSPENSION' }, { status: 400 });
    const { nmdId } = await params;
    const user = await prisma.user.findUnique({ where: { publicNmdId: nmdId }, select: { id: true, publicNmdId: true } });
    if (!user) return NextResponse.json({ error: 'PLAYER_NOT_FOUND' }, { status: 404 });
    const suspension = await prisma.$transaction(async (tx) => {
      const created = await tx.suspension.create({ data: { userId: user.id, issuedById: admin.id, reason: input.data.reason, startsAt: new Date(), endsAt: input.data.endsAt ? new Date(input.data.endsAt) : undefined } });
      await tx.user.update({ where: { id: user.id }, data: { accountStatus: 'SUSPENDED' } });
      return created;
    });
    await writeAudit({ actorId: admin.id, action: 'PLAYER_SUSPENDED', entityType: 'User', entityId: user.id, metadata: { publicNmdId: user.publicNmdId, reason: input.data.reason } });
    return NextResponse.json({ suspension: { id: suspension.id, publicNmdId: user.publicNmdId, endsAt: suspension.endsAt } });
  } catch (error) {
    const result = authError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
