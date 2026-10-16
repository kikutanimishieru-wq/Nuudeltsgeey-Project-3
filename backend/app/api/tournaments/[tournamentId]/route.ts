import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { publicCorsHeaders, publicCorsOptions } from '@/lib/public-cors';

const publicStatuses = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN', 'ROSTER_LOCKED', 'LIVE', 'COMPLETED', 'ARCHIVED'] as const;

export async function GET(request: Request, { params }: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId } = await params;
  const tournament = await prisma.tournament.findFirst({
    where: { id: tournamentId, status: { in: [...publicStatuses] } },
    select: {
      id: true, name: true, venue: true, game: true, format: true, style: true,
      capacity: true, teamSize: true, startersPerTeam: true, maxSubstitutes: true,
      rulesVersion: true, status: true, startsAt: true,
      cafe: { select: { id: true, name: true, district: true } },
      registrations: {
        where: { status: 'APPROVED' },
        orderBy: { team: { name: 'asc' } },
        select: {
          id: true, status: true, checkInStatus: true, rosterLockedAt: true,
          team: { select: { id: true, name: true, tag: true } },
          roster: {
            select: {
              isStarter: true,
              player: { select: { nickname: true, user: { select: { publicNmdId: true } } } },
            },
          },
        },
      },
      matches: {
        orderBy: [{ round: 'asc' }, { bracketOrder: 'asc' }],
        select: {
          id: true, round: true, bracketOrder: true, status: true, result: true,
          winnerTeamId: true, teamAScore: true, teamBScore: true,
          teamA: { select: { id: true, name: true, tag: true } },
          teamB: { select: { id: true, name: true, tag: true } },
        },
      },
    },
  });

  if (!tournament) return NextResponse.json({ error: 'TOURNAMENT_NOT_FOUND' }, { status: 404, headers: publicCorsHeaders(request) });
  return NextResponse.json({ tournament }, { headers: publicCorsHeaders(request) });
}

export function OPTIONS(request: Request) { return publicCorsOptions(request); }
