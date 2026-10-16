import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRankForNr } from '@/lib/ranks';
import { publicCorsHeaders, publicCorsOptions } from '@/lib/public-cors';

const publicStatuses = ['VERIFIED', 'ACTIVE'] as const;

export async function GET(request: Request) {
  const headers = publicCorsHeaders(request);
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.trunc(requestedLimit))) : 50;
  const players = await prisma.playerProfile.findMany({
    where: { user: { accountStatus: { in: [...publicStatuses] } } },
    orderBy: [{ currentNr: 'desc' }, { nickname: 'asc' }],
    take: limit,
    select: {
      nickname: true,
      currentNr: true,
      floor: true,
      verifiedMatches: true,
      wins: true,
      losses: true,
      currentStreak: true,
      user: { select: { publicNmdId: true } },
    },
  });

  return NextResponse.json({
    leaderboard: players.map((player, index) => ({
      rank: index + 1,
      nmdId: player.user.publicNmdId,
      nickname: player.nickname,
      currentNr: player.currentNr,
      floor: player.floor,
      verifiedMatches: player.verifiedMatches,
      wins: player.wins,
      losses: player.losses,
      currentStreak: player.currentStreak,
      mongolianRank: getRankForNr(player.currentNr),
    })),
  }, { headers });
}

export function OPTIONS(request: Request) {
  return publicCorsOptions(request);
}
