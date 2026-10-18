import { assertCurrentPermission } from '@/lib/transaction-authority';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { secureMutation } from '@/lib/secure-route';
import { assertCaseIndependence } from '@/lib/reviewer';
import { assertPermission } from '@/lib/permissions';
import { writeAudit } from '@/lib/audit';
import { SecurityError } from '@/lib/security-error';

const schema = z.object({ reviewerId: z.string().uuid(), involvedUserIds: z.array(z.string().uuid()).min(1).max(128),
  independenceAttested: z.literal(true) }).strict();
export const POST = secureMutation(async (request: Request, { params }: { params: Promise<{ incidentId: string }> }) => {
  const admin = await requirePermission('IDENTITY_REVIEW');
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) throw new SecurityError('INVALID_ASSIGNMENT', 400);
  if (admin.id === input.data.reviewerId) throw new SecurityError('SELF_ASSIGNMENT_FORBIDDEN');
  const { incidentId } = await params;
  await prisma.$transaction(async tx => {
    await assertCurrentPermission(tx, admin.id, 'IDENTITY_REVIEW');
    await tx.$queryRaw`SELECT "id" FROM "Incident" WHERE "id" = ${incidentId} FOR UPDATE`;
    const reviewer = await tx.user.findUnique({ where: { id: input.data.reviewerId }, select: { role: true, accountStatus: true } });
    if (!reviewer) throw new SecurityError('INVALID_REVIEWER', 400);
    assertPermission(reviewer, 'REVIEW_MINOR');
    // Append parties; an administrator cannot erase previously recorded conflicts.
    await tx.incidentParty.createMany({ data: [...new Set(input.data.involvedUserIds)].map(userId => ({ incidentId, userId })), skipDuplicates: true });
    await assertCaseIndependence(tx, incidentId, admin.id);
    await assertCaseIndependence(tx, incidentId, input.data.reviewerId);
    await tx.reviewAssignment.upsert({ where: { incidentId_reviewerId: { incidentId, reviewerId: input.data.reviewerId } },
      create: { incidentId, reviewerId: input.data.reviewerId, assignedById: admin.id }, update: { assignedById: admin.id, attestedAt: new Date() } });
    await writeAudit(tx, { actorId: admin.id, action: 'INDEPENDENT_REVIEW_ASSIGNED', entityType: 'Incident', entityId: incidentId, metadata: { independenceAttested: true, partyCount: new Set(input.data.involvedUserIds).size } });
  });
  return NextResponse.json({ status: 'ASSIGNED' });
});
