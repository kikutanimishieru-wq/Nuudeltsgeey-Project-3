import { secureMutation } from '@/lib/secure-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { authError, requireUser } from '@/lib/session';

const schema = z.object({ name: z.string().trim().min(2).max(60), tag: z.string().trim().min(2).max(8).optional(), cafeId: z.string().uuid().optional() });

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  const teams = await prisma.team.findMany({ where: query ? { OR: [{ name: { contains: query, mode: 'insensitive' } }, { tag: { contains: query, mode: 'insensitive' } }] } : undefined, select: { id: true, name: true, tag: true, captain: { select: { nickname: true } }, cafe: { select: { name: true } } }, take: 50, orderBy: { name: 'asc' } });
  return NextResponse.json({ teams });
}

export const POST = secureMutation(async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!user.profile) return NextResponse.json({ error: 'PLAYER_PROFILE_REQUIRED' }, { status: 409 });
    const input = schema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: 'INVALID_TEAM' }, { status: 400 });
    const team = await prisma.$transaction(async (tx) => {
      const created = await tx.team.create({ data: { name: input.data.name, tag: input.data.tag, cafeId: input.data.cafeId, captainId: user.profile!.id } });
      await tx.teamMembership.create({ data: { teamId: created.id, playerId: user.profile!.id, isStarter: true } });
      await tx.playerProfile.update({ where: { id: user.profile!.id }, data: { currentTeamId: created.id } });
      await writeAudit(tx, { actorId: user.id, action: 'TEAM_CREATED', entityType: 'Team', entityId: created.id });
      return created;
    });
    return NextResponse.json({ team }, { status: 201 });
  } catch (error) {
    const result = authError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
});
