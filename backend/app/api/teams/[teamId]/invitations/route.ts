import { secureMutation } from '@/lib/secure-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { authError, requireUser } from '@/lib/session';

const schema = z.object({ nmdId: z.string().regex(/^NMD-\d{6}$/) });

export const POST = secureMutation(async function POST(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
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
    const invitedPlayerId = player.profile.id;
    const invitation = await prisma.$transaction(async tx => {
      const created = await tx.teamInvitation.create({ data: { teamId, playerId: invitedPlayerId }, select: { id: true, status: true, teamId: true, playerId: true } });
      await writeAudit(tx, { actorId: user.id, action: 'TEAM_INVITATION_CREATED', entityType: 'TeamInvitation', entityId: created.id });
      return created;
    });
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    const result = authError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
});
