import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { secureMutation } from '@/lib/secure-route';
import { requireIndependentReviewer } from '@/lib/reviewer';
import { writeAudit } from '@/lib/audit';
import { lockIdentityUser } from '@/lib/identity';
import { SecurityError } from '@/lib/security-error';
const schema = z.object({ incidentId: z.string().uuid(), reason: z.string().trim().min(3).max(1000), endsAt: z.string().datetime() }).strict();
export const POST = secureMutation(async (request: Request, { params }: { params: Promise<{ nmdId: string }> }) => {
  const admin = await requirePermission('REVIEW_SERIOUS');
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success || new Date(input.data.endsAt) <= new Date()) throw new SecurityError('DEFINED_FUTURE_SUSPENSION_REQUIRED', 400);
  const { nmdId } = await params;
  const suspension = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Incident" WHERE "id" = ${input.data.incidentId} FOR UPDATE`;
    const incident = await requireIndependentReviewer(tx, admin, input.data.incidentId, true);
    const user = await tx.user.findUnique({ where: { publicNmdId: nmdId }, select: { id: true } });
    if (!user || !incident.parties.some(party => party.userId === user.id) || incident.status !== 'VIOLATION_ESTABLISHED' || incident.penalty !== 'SUSPENSION') throw new SecurityError('AUTHORIZED_SUSPENSION_DECISION_REQUIRED', 409);
    await lockIdentityUser(tx, user.id);
    // The same adjudicated case must not produce duplicate sanctions.
    const prior = await tx.auditEvent.findFirst({ where: { entityType: 'Incident', entityId: incident.id, action: 'SUSPENSION_EXECUTED' }, select: { id: true } });
    if (prior) throw new SecurityError('SANCTION_ALREADY_EXECUTED', 409);
    const created = await tx.suspension.create({ data: { userId: user.id, issuedById: admin.id, reason: input.data.reason, startsAt: new Date(), endsAt: new Date(input.data.endsAt) } });
    await tx.user.update({ where: { id: user.id }, data: { accountStatus: 'SUSPENDED' } });
    await writeAudit(tx, { actorId: admin.id, action: 'SUSPENSION_EXECUTED', entityType: 'Incident', entityId: incident.id, metadata: { suspensionId: created.id } });
    return { id: created.id, endsAt: created.endsAt };
  });
  return NextResponse.json({ suspension });
});
