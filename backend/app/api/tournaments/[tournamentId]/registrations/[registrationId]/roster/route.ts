import { NextResponse } from 'next/server';
import { requireCompetitiveUser } from '@/lib/session';
import { secureMutation } from '@/lib/secure-route';
import { editRoster } from '@/lib/tournament-registration';
export const POST = secureMutation(async (request: Request, { params }: { params: Promise<{ tournamentId: string; registrationId: string }> }) => {
  const actor = await requireCompetitiveUser();
  const { tournamentId, registrationId } = await params;
  return NextResponse.json(await editRoster(actor.id, tournamentId, registrationId, await request.json().catch(() => null)));
});
