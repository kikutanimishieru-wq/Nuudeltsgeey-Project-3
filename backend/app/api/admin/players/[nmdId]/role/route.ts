import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { assertPermission } from '@/lib/permissions';
import { secureMutation } from '@/lib/secure-route';
import { lockIdentityUser } from '@/lib/identity';
import { writeAudit } from '@/lib/audit';
import { SecurityError } from '@/lib/security-error';
const schema = z.object({ role: z.enum(['PLAYER', 'REFEREE', 'ADMIN']), reason: z.string().trim().min(10).max(1000) }).strict();
export const POST = secureMutation(async (request: Request, { params }: { params: Promise<{ nmdId: string }> }) => {
  const actor = await requirePermission('ROLE_MANAGEMENT');
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) throw new SecurityError('INVALID_ROLE_CHANGE', 400);
  const { nmdId } = await params;
  await prisma.$transaction(async tx => {
    const target = await tx.user.findUnique({ where: { publicNmdId: nmdId }, select: { id: true } });
    if (!target || target.id === actor.id) throw new SecurityError('FORBIDDEN');
    for (const id of [target.id, actor.id].sort()) await lockIdentityUser(tx, id);
    const currentActor = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
    assertPermission(currentActor, 'ROLE_MANAGEMENT');
    const current = await tx.user.findUniqueOrThrow({ where: { id: target.id }, select: { role: true } });
    // This API cannot create, remove or transfer platform-owner authority.
    if (current.role === 'SUPER_ADMIN') throw new SecurityError('OWNER_ROLE_CHANGE_UNAVAILABLE');
    await tx.user.update({ where: { id: target.id }, data: { role: input.data.role } });
    await writeAudit(tx, { actorId: actor.id, action: 'ROLE_CHANGED', entityType: 'User', entityId: target.id,
      metadata: { beforeRole: current.role, afterRole: input.data.role, reason: input.data.reason } });
  });
  return NextResponse.json({ status: 'ROLE_UPDATED' });
});
