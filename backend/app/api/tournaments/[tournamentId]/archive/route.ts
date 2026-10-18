import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/session';
import { secureMutation } from '@/lib/secure-route';
import { archiveHostedDraft } from '@/lib/tournament-hosting';
export const POST = secureMutation(async (_: Request, { params }: { params: Promise<{ tournamentId: string }> }) => {
  const user = await requireUser();
  return NextResponse.json({ tournament: await archiveHostedDraft(user.id, (await params).tournamentId) });
});
