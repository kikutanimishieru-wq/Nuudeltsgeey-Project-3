import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { publicCorsHeaders, publicCorsOptions } from '@/lib/public-cors';

const publicStatuses = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN', 'ROSTER_LOCKED', 'LIVE', 'COMPLETED', 'ARCHIVED'] as const;

export async function GET(request: Request) {
  const tournaments = await prisma.tournament.findMany({
    where: { status: { in: [...publicStatuses] } },
    orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      name: true,
      venue: true,
      game: true,
      format: true,
      style: true,
      capacity: true,
      teamSize: true,
      status: true,
      startsAt: true,
      cafe: { select: { id: true, name: true, district: true } },
      _count: { select: { registrations: true, matches: true } },
    },
  });

  return NextResponse.json({ tournaments }, { headers: publicCorsHeaders(request) });
}

export function OPTIONS(request: Request) { return publicCorsOptions(request); }
