import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { publicCorsHeaders, publicCorsOptions } from '@/lib/public-cors';
import { getRankForNr } from '@/lib/ranks';

export async function GET(request: Request, { params }: { params: Promise<{ nmdId: string }> }) {
  const { nmdId } = await params;
  const user = await prisma.user.findFirst({
    where: { publicNmdId: nmdId, accountStatus: { in: ['VERIFIED', 'ACTIVE'] } },
    select: {
      publicNmdId: true,
      profile: {
        select: {
          nickname: true, currentNr: true, floor: true, verifiedMatches: true,
          wins: true, losses: true, currentStreak: true,
          matchParticipants: {
            where: { match: { status: 'LOCKED' } },
            orderBy: { match: { lockedAt: 'desc' } },
            select: {
              team: { select: { id: true, name: true, tag: true } },
              match: {
                select: {
                  id: true, round: true, status: true, result: true, winnerTeamId: true,
                  teamAScore: true, teamBScore: true, lockedAt: true,
                  tournament: { select: { id: true, name: true } },
                  teamA: { select: { id: true, name: true, tag: true } },
                  teamB: { select: { id: true, name: true, tag: true } },
                },
              },
            },
          },
          ratingTransactions: {
            orderBy: { createdAt: 'desc' }, take: 100,
            select: { type: true, delta: true, beforeNr: true, afterNr: true, note: true, createdAt: true },
          },
        },
      },
    },
  });

  if (!user?.profile) return NextResponse.json({ error: 'PLAYER_NOT_FOUND' }, { status: 404, headers: publicCorsHeaders(request) });
  return NextResponse.json({ player: {
    nmdId: user.publicNmdId, nickname: user.profile.nickname, currentNr: user.profile.currentNr,
    floor: user.profile.floor, verifiedMatches: user.profile.verifiedMatches, wins: user.profile.wins,
    losses: user.profile.losses, currentStreak: user.profile.currentStreak,
    matches: user.profile.matchParticipants.map(({ team, match }) => ({ ...match, playerTeam: team })),
    ratingHistory: user.profile.ratingTransactions,
    mongolianRank: getRankForNr(user.profile.currentNr),
  } }, { headers: publicCorsHeaders(request) });
}

export function OPTIONS(request: Request) { return publicCorsOptions(request); }
