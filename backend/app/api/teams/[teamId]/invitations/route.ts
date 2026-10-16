import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authError, requireUser } from '@/lib/session';

const schema = z.object({ nmdId: z.string().regex(/^NMD-\d{6}$/) });

export async function POST(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  try {
    const user = await requireUser();
    const input = schema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: 'INVALID_PLAYER_ID' }, { status: 400 });
    const { teamId } = await params;
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, captainId: true } });
    if (!team || team.captainId !== user.profile?.id) return NextResponse.json({ error: 'CAPTAIN_REQUIRED' }, { status: 403 });
    const player = await prisma.user.findUnique({ where: { publicNmdId: input.data.nmdId }, select: { profile: { select: { id: true } } } });
    if (!player?.profile) return NextResponse.json({ error: 'PLAYER_NOT_FOUND' }, { status: 404 });
    if (player.profile.id === user.profile?.id) return NextResponse.json({ error: 'CAPTAIN_ALREADY_ON_TEAM' }, { status: 409 });
    const invitation = await prisma.teamInvitation.create({ data: { teamId, playerId: player.profile.id }, select: { id: true, status: true, teamId: true, playerId: true } });
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    const result = authError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
