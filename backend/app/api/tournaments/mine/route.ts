import { NextResponse } from 'next/server';
import { requireUser, authError } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { configurationResponse, ownedConfigurationSelect } from '@/lib/tournament-hosting';
export async function GET() {
  try {
    const user = await requireUser();
    const tournaments = await prisma.tournament.findMany({ where: { hostUserId: user.id }, orderBy: { createdAt: 'desc' }, select: ownedConfigurationSelect });
    return NextResponse.json({ tournaments: tournaments.map(configurationResponse) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { const result = authError(error); return NextResponse.json({ error: result.error }, { status: result.status, headers: { 'Cache-Control': 'no-store' } }); }
}
