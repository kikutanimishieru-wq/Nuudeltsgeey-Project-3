import { assertTournamentOperationAvailable } from '@/lib/tournament-activation';
import { assertCurrentPermission } from '@/lib/transaction-authority';
import { assertTournamentIndependent } from '@/lib/competition-authority';
import { secureMutation } from '@/lib/secure-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { awardTournamentResults } from '@/lib/tournament-awards';
import { authError, requireAdmin } from '@/lib/session';
import { writeAudit } from '@/lib/audit';

const schema = z.object({
  placements: z.array(z.object({ playerId: z.string().uuid(), kind: z.enum(['PARTICIPATION', 'CHAMPION', 'RUNNER_UP', 'SEMIFINALIST']) })).min(1),
});

export const POST = secureMutation(async function POST(request: Request, { params }: { params: Promise<{ tournamentId: string }> }) {
  try {
    const admin = await requireAdmin();
    const input = schema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: 'INVALID_TOURNAMENT_AWARDS' }, { status: 400 });
    const { tournamentId } = await params;
    const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, include: { matches: { select: { status: true } }, registrations: { where: { status: 'APPROVED' }, include: { roster: { select: { playerId: true } } } } } });
    if (!tournament) return NextResponse.json({ error: 'TOURNAMENT_NOT_FOUND' }, { status: 404 });
    if (tournament.matches.length && tournament.matches.some((match) => match.status !== 'LOCKED')) return NextResponse.json({ error: 'ALL_MATCHES_MUST_BE_LOCKED' }, { status: 409 });
    const eligiblePlayers = new Set(tournament.registrations.flatMap((registration) => registration.roster.map((member) => member.playerId)));
    if (input.data.placements.some((placement) => !eligiblePlayers.has(placement.playerId))) return NextResponse.json({ error: 'AWARD_PLAYER_NOT_IN_TOURNAMENT_ROSTER' }, { status: 409 });
    const result = await prisma.$transaction(async (tx) => {
      await assertCurrentPermission(tx, admin.id, 'ADMIN_DASHBOARD');
      await assertTournamentOperationAvailable(tx, tournamentId, false);
      await assertTournamentIndependent(tx, admin.id, tournamentId);
      await awardTournamentResults(tx, tournamentId, input.data.placements);
      const completed = await tx.tournament.update({ where: { id: tournamentId }, data: { status: 'COMPLETED' }, select: { id: true, status: true } });
      await writeAudit(tx, { actorId: admin.id, action: 'TOURNAMENT_COMPLETED', entityType: 'Tournament', entityId: tournamentId, tournamentId, metadata: { placementCount: input.data.placements.length } });
      return completed;
    });
    return NextResponse.json({ tournament: result });
  } catch (error) {
    const result = authError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
});
