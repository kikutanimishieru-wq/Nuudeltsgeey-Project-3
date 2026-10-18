import { assertCurrentPermission } from '@/lib/transaction-authority';
import { assertTournamentIndependent } from '@/lib/competition-authority';
import { secureMutation } from '@/lib/secure-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authError, requireAdmin } from '@/lib/session';
import { writeAudit } from '@/lib/audit';

export const POST = secureMutation(async function POST(_: Request, { params }: { params: Promise<{ matchId: string }> }) {
  try {
    const admin = await requireAdmin();
    const { matchId } = await params;
    const match = await prisma.match.findUnique({ where: { id: matchId }, include: { confirmations: true } });
    if (!match) return NextResponse.json({ error: 'MATCH_NOT_FOUND' }, { status: 404 });
    if (match.status !== 'AWAITING_CONFIRMATION' && match.status !== 'DISPUTED') return NextResponse.json({ error: 'MATCH_NOT_READY_FOR_VERIFICATION' }, { status: 409 });
    const confirmedTeams = new Set(match.confirmations.filter((confirmation) => confirmation.decision === 'CONFIRMED').map((confirmation) => confirmation.teamId));
    if (confirmedTeams.size < 2) return NextResponse.json({ error: 'BOTH_TEAMS_MUST_CONFIRM_RESULT' }, { status: 409 });
    const updated = await prisma.$transaction(async tx => {
      await assertCurrentPermission(tx, admin.id, 'ADMIN_DASHBOARD');
      await assertTournamentIndependent(tx, admin.id, match.tournamentId);
      const changed = await tx.match.update({ where: { id: matchId }, data: { status: 'VERIFIED' }, select: { id: true, status: true } });
      await writeAudit(tx, { actorId: admin.id, action: 'RESULT_VERIFIED', entityType: 'Match', entityId: matchId, matchId });
      return changed;
    });
    return NextResponse.json({ match: updated });
  } catch (error) {
    const result = authError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
});
