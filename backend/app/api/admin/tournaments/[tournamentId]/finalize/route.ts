import { z } from 'zod';
import { SecurityError } from '@/lib/security-error';
import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { secureMutation } from '@/lib/secure-route';
import { finalizeTournament } from '@/lib/tournament-registration';
export const POST = secureMutation(async (request: Request, { params }: { params: Promise<{ tournamentId: string }> }) => {
  const text = await request.text();
  if (text.trim()) {
    let input: unknown;
    try { input = JSON.parse(text); } catch { throw new SecurityError('INVALID_INPUT', 400); }
    if (!z.object({}).strict().safeParse(input).success) throw new SecurityError('FINALIZATION_ACCEPTS_NO_OVERRIDES', 400);
  }
  const actor = await requirePermission('REVIEW_MINOR');
  return NextResponse.json(await finalizeTournament(actor.id, (await params).tournamentId));
});
