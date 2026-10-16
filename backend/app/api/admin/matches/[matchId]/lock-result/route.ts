import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authError, requireAdmin } from '@/lib/session';
import { writeAudit } from '@/lib/audit';
import { matchDelta } from '@/lib/ranking';
import { getNextMatchPosition } from '@/lib/bracket';

const schema = z.object({
  teamAScore: z.number().int().min(0),
  teamBScore: z.number().int().min(0),
  result: z.enum(['WIN', 'LOSS', 'FORFEIT']),
  winnerTeamId: z.string().min(1),
});

export async function POST(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  try {
    const admin = await requireAdmin();
    const input = schema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: 'INVALID_RESULT' }, { status: 400 });
    const { matchId } = await params;

    const result = await prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({ where: { id: matchId }, include: { tournament: true, participants: { include: { player: true } } } });
      if (!match) throw new Error('MATCH_NOT_FOUND');
      if (match.status !== 'VERIFIED') throw new Error('MATCH_MUST_BE_VERIFIED_BEFORE_LOCK');
      if (![match.teamAId, match.teamBId].includes(input.data.winnerTeamId)) throw new Error('INVALID_WINNER');
      const expectedParticipants = match.tournament.teamSize * 2;
      if (match.participants.length !== expectedParticipants) throw new Error('MATCH_PARTICIPANT_COUNT_DOES_NOT_MATCH_TOURNAMENT_FORMAT');
      if (await tx.rankingEvent.findUnique({ where: { matchId } })) throw new Error('RESULT_ALREADY_LOCKED');

      const teamIds = [match.teamAId, match.teamBId].filter((id): id is string => Boolean(id));
      const averageByTeam = new Map<string, number>();
      for (const teamId of teamIds) {
        const players = match.participants.filter((participant) => participant.teamId === teamId);
        if (players.length !== match.tournament.teamSize) throw new Error('TEAM_PARTICIPANT_COUNT_DOES_NOT_MATCH_TOURNAMENT_FORMAT');
        averageByTeam.set(teamId, players.reduce((sum, participant) => sum + participant.player.currentNr, 0) / players.length);
      }

      const rankingEvent = await tx.rankingEvent.create({ data: { matchId } });
      const ratingRows: Array<{
        rankingEventId: string;
        playerId: string;
        type: 'MATCH_RESULT';
        delta: number;
        beforeNr: number;
        afterNr: number;
        note: string;
      }> = [];
      const profileRows: Prisma.Sql[] = [];
      for (const participant of match.participants) {
        const opponentTeamId = teamIds.find((teamId) => teamId !== participant.teamId);
        if (!opponentTeamId) throw new Error('MATCH_TEAMS_REQUIRED');
        const won = participant.teamId === input.data.winnerTeamId;
        const delta = matchDelta(participant.player.currentNr, averageByTeam.get(opponentTeamId) ?? participant.player.currentNr, participant.player.floor, won);
        const afterNr = Math.max(0, participant.player.currentNr + delta);
        ratingRows.push({ rankingEventId: rankingEvent.id, playerId: participant.playerId, type: 'MATCH_RESULT', delta, beforeNr: participant.player.currentNr, afterNr, note: won ? 'Verified match win' : 'Verified match loss' });
        profileRows.push(Prisma.sql`(${participant.playerId}, ${afterNr}, ${won ? 1 : 0}, ${won ? 0 : 1}, ${won ? participant.player.currentStreak + 1 : 0})`);
      }
      await tx.ratingTransaction.createMany({ data: ratingRows });
      await tx.$executeRaw(Prisma.sql`UPDATE "PlayerProfile" AS p
        SET "currentNr" = v."afterNr",
            "verifiedMatches" = p."verifiedMatches" + 1,
            "wins" = p."wins" + v."wins",
            "losses" = p."losses" + v."losses",
            "currentStreak" = v."currentStreak"
        FROM (VALUES ${Prisma.join(profileRows)}) AS v("id", "afterNr", "wins", "losses", "currentStreak")
        WHERE p."id" = v."id"`);
      const locked = await tx.match.update({ where: { id: matchId }, data: { status: 'LOCKED', result: input.data.result, winnerTeamId: input.data.winnerTeamId, teamAScore: input.data.teamAScore, teamBScore: input.data.teamBScore, lockedAt: new Date() }, select: { id: true, status: true, winnerTeamId: true, round: true, bracketOrder: true, tournamentId: true } });
      const nextPosition = getNextMatchPosition(locked.round, locked.bracketOrder);
      if (nextPosition) {
        const nextMatch = await tx.match.findUnique({ where: { tournamentId_round_bracketOrder: { tournamentId: locked.tournamentId, round: nextPosition.round, bracketOrder: nextPosition.bracketOrder } }, select: { id: true, teamAId: true, teamBId: true } });
        if (nextMatch) {
          const nextTeamAId = nextPosition.slot === 'A' ? input.data.winnerTeamId : nextMatch.teamAId;
          const nextTeamBId = nextPosition.slot === 'B' ? input.data.winnerTeamId : nextMatch.teamBId;
          await tx.match.update({ where: { id: nextMatch.id }, data: { teamAId: nextTeamAId, teamBId: nextTeamBId, status: nextTeamAId && nextTeamBId ? 'READY' : 'PENDING' } });
        }
      }
      return locked;
    }, { timeout: 60000 });
    await writeAudit({ actorId: admin.id, action: 'RESULT_LOCKED', entityType: 'Match', entityId: matchId, matchId, metadata: input.data });
    return NextResponse.json({ result });
  } catch (error) {
    console.error('Admin result lock failed', error);
    if (error instanceof Error && ['MATCH_NOT_FOUND', 'MATCH_MUST_BE_VERIFIED_BEFORE_LOCK', 'INVALID_WINNER', 'MATCH_PARTICIPANT_COUNT_DOES_NOT_MATCH_TOURNAMENT_FORMAT', 'TEAM_PARTICIPANT_COUNT_DOES_NOT_MATCH_TOURNAMENT_FORMAT', 'MATCH_TEAMS_REQUIRED', 'RESULT_ALREADY_LOCKED'].includes(error.message)) return NextResponse.json({ error: error.message }, { status: 409 });
    const result = authError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
