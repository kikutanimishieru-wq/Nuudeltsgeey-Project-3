import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authError, requireAdmin } from '@/lib/session';
import { writeAudit } from '@/lib/audit';

const schema = z.object({
  teamAScore: z.number().int().min(0),
  teamBScore: z.number().int().min(0),
  result: z.enum(['WIN', 'FORFEIT']),
  winnerTeamId: z.string().min(1),
});

export async function POST(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  try {
    const admin = await requireAdmin();
    const input = schema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: 'INVALID_RESULT' }, { status: 400 });
    const { matchId } = await params;
    const updated = await prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({ where: { id: matchId }, include: { tournament: true } });
      if (!match) throw new Error('MATCH_NOT_FOUND');
      if (match.status !== 'READY' && match.status !== 'LIVE') throw new Error('MATCH_NOT_READY_FOR_RESULT');
      if (!match.teamAId || !match.teamBId || ![match.teamAId, match.teamBId].includes(input.data.winnerTeamId)) throw new Error('MATCH_TEAMS_REQUIRED');
      if (input.data.result === 'WIN' && input.data.teamAScore === input.data.teamBScore) throw new Error('TIED_SCORE_NOT_ALLOWED');
      if (input.data.result === 'WIN' && ((input.data.winnerTeamId === match.teamAId && input.data.teamAScore < input.data.teamBScore) || (input.data.winnerTeamId === match.teamBId && input.data.teamBScore < input.data.teamAScore))) throw new Error('WINNER_SCORE_MISMATCH');

      const registrations = await tx.tournamentRegistration.findMany({ where: { tournamentId: match.tournamentId, teamId: { in: [match.teamAId, match.teamBId] } }, include: { roster: true } });
      const participants = registrations.flatMap((registration) => registration.roster.map((member) => ({ matchId, teamId: registration.teamId, playerId: member.playerId, isSubstitute: !member.isStarter })));
      if (participants.length !== match.tournament.teamSize * 2) throw new Error('MATCH_PARTICIPANT_COUNT_DOES_NOT_MATCH_TOURNAMENT_FORMAT');
      await tx.matchParticipant.createMany({ data: participants, skipDuplicates: true });
      return tx.match.update({ where: { id: matchId }, data: { status: 'VERIFIED', result: input.data.result, winnerTeamId: input.data.winnerTeamId, teamAScore: input.data.teamAScore, teamBScore: input.data.teamBScore, submittedAt: new Date() }, select: { id: true, status: true, result: true, winnerTeamId: true } });
    }, { timeout: 60000 });
    await writeAudit({ actorId: admin.id, action: 'ADMIN_RESULT_RECORDED', entityType: 'Match', entityId: matchId, matchId, metadata: input.data });
    return NextResponse.json({ result: updated });
  } catch (error) {
    console.error('Admin result record failed', error);
    if (error instanceof Error && ['MATCH_NOT_FOUND', 'MATCH_NOT_READY_FOR_RESULT', 'MATCH_TEAMS_REQUIRED', 'TIED_SCORE_NOT_ALLOWED', 'WINNER_SCORE_MISMATCH', 'MATCH_PARTICIPANT_COUNT_DOES_NOT_MATCH_TOURNAMENT_FORMAT'].includes(error.message)) return NextResponse.json({ error: error.message }, { status: 409 });
    const result = authError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
