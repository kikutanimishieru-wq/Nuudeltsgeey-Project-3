import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authError, requireUser } from '@/lib/session';

const schema = z.object({ decision: z.enum(['ACCEPT', 'DECLINE']) });

export async function POST(request: Request, { params }: { params: Promise<{ invitationId: string }> }) {
  try {
    const user = await requireUser();
    const input = schema.safeParse(await request.json().catch(() => null));
    if (!input.success || !user.profile) return NextResponse.json({ error: 'INVALID_INVITATION_DECISION' }, { status: 400 });
    const { invitationId } = await params;
    const invitation = await prisma.teamInvitation.findUnique({ where: { id: invitationId }, include: { team: true } });
    if (!invitation || invitation.playerId !== user.profile.id || invitation.status !== 'PENDING') return NextResponse.json({ error: 'INVITATION_NOT_AVAILABLE' }, { status: 404 });
    if (input.data.decision === 'DECLINE') {
      const declined = await prisma.teamInvitation.update({ where: { id: invitationId }, data: { status: 'DECLINED', respondedAt: new Date() }, select: { id: true, status: true } });
      return NextResponse.json({ invitation: declined });
    }
    const accepted = await prisma.$transaction(async (tx) => {
      const updated = await tx.teamInvitation.update({ where: { id: invitationId }, data: { status: 'ACCEPTED', respondedAt: new Date() }, select: { id: true, status: true, teamId: true } });
      await tx.teamMembership.create({ data: { teamId: invitation.teamId, playerId: user.profile!.id, isStarter: true } });
      await tx.playerProfile.update({ where: { id: user.profile!.id }, data: { currentTeamId: invitation.teamId } });
      return updated;
    });
    return NextResponse.json({ invitation: accepted });
  } catch (error) {
    const result = authError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
