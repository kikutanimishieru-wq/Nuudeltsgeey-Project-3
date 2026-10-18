import { assertTournamentOperationAvailable } from '@/lib/tournament-activation';
import { assertCurrentPermission } from '@/lib/transaction-authority';
import { assertRosterIdentities, assertTournamentIndependent } from '@/lib/competition-authority';
import { secureMutation } from '@/lib/secure-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authError, requireAdmin } from '@/lib/session';
import { writeAudit } from '@/lib/audit';

const schema = z.object({ decision: z.enum(['APPROVED', 'REJECTED', 'WAITLISTED', 'RETURNED']), reason: z.string().trim().max(500).optional() });

export const POST = secureMutation(async function POST(request: Request, { params }: { params: Promise<{ tournamentId: string; registrationId: string }> }) {
  try {
    const admin = await requireAdmin();
    const input = schema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: 'INVALID_REGISTRATION_DECISION' }, { status: 400 });
    const { tournamentId, registrationId } = await params;
    const status = input.data.decision === 'RETURNED' ? 'PENDING' : input.data.decision;
    const existing = await prisma.tournamentRegistration.findUnique({ where: { id: registrationId }, select: { id: true, tournamentId: true } });
    if (!existing || existing.tournamentId !== tournamentId) return NextResponse.json({ error: 'REGISTRATION_NOT_FOUND' }, { status: 404 });
    const registration = await prisma.$transaction(async tx => {
      await assertCurrentPermission(tx, admin.id, 'ADMIN_DASHBOARD');
      await assertTournamentOperationAvailable(tx, tournamentId, false);
      await assertTournamentIndependent(tx, admin.id, tournamentId);
      if (status === 'APPROVED') await assertRosterIdentities(tx, tournamentId, registrationId);
      const changed = await tx.tournamentRegistration.update({ where: { id: registrationId }, data: { status }, select: { id: true, status: true, tournamentId: true, teamId: true } });
      await writeAudit(tx, { actorId: admin.id, action: `REGISTRATION_${input.data.decision}`, entityType: 'TournamentRegistration', entityId: changed.id, tournamentId, metadata: { teamId: changed.teamId, reason: input.data.reason ?? null } });
      return changed;
    });
    return NextResponse.json({ registration });
  } catch (error) {
    const result = authError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
});
