import { assertTournamentOperationAvailable } from '@/lib/tournament-activation';
import { assertCurrentPermission } from '@/lib/transaction-authority';
import { assertRosterIdentities } from '@/lib/competition-authority';
import { secureMutation } from '@/lib/secure-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildSingleEliminationBracket } from '@/lib/bracket';
import { authError, requireAdmin } from '@/lib/session';
import { writeAudit } from '@/lib/audit';

export const POST = secureMutation(async function POST(_: Request, { params }: { params: Promise<{ tournamentId: string }> }) {
  try {
    const admin = await requireAdmin();
    const { tournamentId } = await params;
    const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, include: { registrations: { where: { status: 'APPROVED' }, include: { roster: true } }, matches: { select: { id: true } } } });
    if (!tournament) return NextResponse.json({ error: 'TOURNAMENT_NOT_FOUND' }, { status: 404 });
    if (tournament.status !== 'ROSTER_LOCKED') return NextResponse.json({ error: 'ROSTERS_MUST_BE_LOCKED_FIRST' }, { status: 409 });
    if (tournament.matches.length) return NextResponse.json({ error: 'BRACKET_ALREADY_EXISTS' }, { status: 409 });
    const eligible = tournament.registrations.filter((registration) => ['PRESENT', 'LATE'].includes(registration.checkInStatus) && registration.rosterLockedAt);
    if (eligible.length < 2) return NextResponse.json({ error: 'AT_LEAST_TWO_CHECKED_IN_TEAMS_REQUIRED' }, { status: 409 });
    if (eligible.some(registration => !registration.teamId)) return NextResponse.json({ error: 'SOLO_BRACKETS_REQUIRE_PHASE5' }, { status: 409 });
    const bracket = buildSingleEliminationBracket(eligible.map((registration) => registration.teamId!));
    await prisma.$transaction(async (tx) => {
      await assertCurrentPermission(tx, admin.id, 'ADMIN_DASHBOARD');
      await assertTournamentOperationAvailable(tx, tournamentId, true);
      await assertRosterIdentities(tx, tournamentId);
      await tx.match.createMany({ data: bracket.map((match) => ({ tournamentId, round: match.round, bracketOrder: match.bracketOrder, teamAId: match.teamAId, teamBId: match.teamBId, status: match.teamAId && match.teamBId ? 'READY' : 'PENDING' })) });
      await writeAudit(tx, { actorId: admin.id, action: 'BRACKET_GENERATED', entityType: 'Tournament', entityId: tournamentId, tournamentId, metadata: { teams: eligible.length, matches: bracket.length, systemGenerated: true } });
    });
    return NextResponse.json({ status: 'BRACKET_GENERATED', matches: bracket });
  } catch (error) {
    const result = authError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
});
