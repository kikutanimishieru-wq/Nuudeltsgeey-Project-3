import { NextResponse } from 'next/server';
import { requireCompetitiveUser } from '@/lib/session';
import { secureMutation } from '@/lib/secure-route';
import { openRegistration } from '@/lib/tournament-registration';
export const POST = secureMutation(async (request: Request, { params }: { params: Promise<{ tournamentId: string }> }) => {
  const actor = await requireCompetitiveUser();
  return NextResponse.json(await openRegistration(actor.id, (await params).tournamentId));
});
