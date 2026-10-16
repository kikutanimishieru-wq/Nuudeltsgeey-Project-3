import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authError, requireAdmin } from '@/lib/session';
import { writeAudit } from '@/lib/audit';

const schema = z.object({
  status: z.enum(['UNDER_REVIEW', 'VIOLATION_ESTABLISHED', 'CLOSED']),
  penalty: z.enum(['NONE', 'WARNING', 'COMPETITIVE_PENALTY', 'TOURNAMENT_REMOVAL', 'SUSPENSION', 'BADGE_REVOCATION']),
  playerResponse: z.string().trim().max(2000).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ incidentId: string }> }) {
  try {
    const admin = await requireAdmin();
    const input = schema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: 'INVALID_INCIDENT_DECISION' }, { status: 400 });
    const { incidentId } = await params;
    const incident = await prisma.incident.update({ where: { id: incidentId }, data: { status: input.data.status, penalty: input.data.penalty, playerResponse: input.data.playerResponse, reviewerId: admin.id, decidedAt: new Date() }, select: { id: true, status: true, penalty: true, decidedAt: true } });
    await writeAudit({ actorId: admin.id, action: 'INCIDENT_DECIDED', entityType: 'Incident', entityId: incidentId, metadata: input.data });
    return NextResponse.json({ incident });
  } catch (error) {
    const result = authError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
