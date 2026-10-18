import { NextResponse } from 'next/server';
import { requireCompetitiveUser } from '@/lib/session';
import { secureMutation } from '@/lib/secure-route';
import { checkInPlayer } from '@/lib/tournament-registration';
export const POST = secureMutation(async (request: Request, { params }: { params: Promise<{ tournamentId: string }> }) => {
  const actor = await requireCompetitiveUser();
  return NextResponse.json(await checkInPlayer(actor.id, (await params).tournamentId, await request.text().then(text => text.trim() ? JSON.parse(text) : {}).catch(() => null)));
});
