import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { secureMutation } from '@/lib/secure-route';
import { requireIndependentReviewer } from '@/lib/reviewer';
import { writeAudit } from '@/lib/audit';
import { SecurityError } from '@/lib/security-error';

const schema = z.object({ status: z.enum(['UNDER_REVIEW', 'VIOLATION_ESTABLISHED', 'CLOSED']),
  penalty: z.enum(['NONE', 'WARNING', 'COMPETITIVE_PENALTY', 'TOURNAMENT_REMOVAL', 'SUSPENSION', 'BADGE_REVOCATION']) }).strict();
export const POST = secureMutation(async (request: Request, { params }: { params: Promise<{ incidentId: string }> }) => {
  const actor = await requirePermission('REVIEW_MINOR');
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) throw new SecurityError('INVALID_INCIDENT_DECISION', 400);
  if (input.data.penalty === 'BADGE_REVOCATION') throw new SecurityError('BADGE_CATALOG_AND_OWNER_APPROVAL_REQUIRED', 409);
  if (input.data.status !== 'VIOLATION_ESTABLISHED' && input.data.penalty !== 'NONE') throw new SecurityError('VIOLATION_FINDING_REQUIRED', 409);
  const { incidentId } = await params;
  const incident = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Incident" WHERE "id" = ${incidentId} FOR UPDATE`;
    const existing = await tx.incident.findUnique({ where: { id: incidentId }, select: { category: true } });
    // Unknown categories fail closed to administrator review.
    const minorCategory = existing && ['LATENESS', 'MINOR_CONDUCT', 'ORDINARY_MATCH_DISPUTE'].includes(existing.category);
    const serious = !minorCategory || !['NONE', 'WARNING', 'COMPETITIVE_PENALTY'].includes(input.data.penalty);
    const context = await requireIndependentReviewer(tx, actor, incidentId, serious);
    if (context.decidedAt || ['VIOLATION_ESTABLISHED', 'CLOSED'].includes(context.status)) throw new SecurityError('DECISION_REQUIRES_APPEAL_OR_CORRECTION', 409);
    if (input.data.status === 'VIOLATION_ESTABLISHED' && (context.status !== 'UNDER_REVIEW' || !context.evidenceRef || !context.playerResponse)) throw new SecurityError('EVIDENCE_AND_RESPONSE_REQUIRED', 409);
    const updated = await tx.incident.update({ where: { id: incidentId }, data: { ...input.data, reviewerId: actor.id,
      decidedAt: input.data.status === 'UNDER_REVIEW' ? null : new Date() }, select: { id: true, status: true, penalty: true, decidedAt: true } });
    await writeAudit(tx, { actorId: actor.id, action: 'INCIDENT_DECIDED', entityType: 'Incident', entityId: incidentId, metadata: { status: input.data.status, penalty: input.data.penalty } });
    return updated;
  });
  return NextResponse.json({ incident });
});
