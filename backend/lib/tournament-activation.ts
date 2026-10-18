import type { Prisma } from '@prisma/client';
import { assertNoPhase3Activation } from './tournament-configuration';
import { SecurityError } from './security-error';
export async function assertTournamentOperationAvailable(tx: Prisma.TransactionClient, tournamentId: string, activating = false) {
  const event = await tx.tournament.findUnique({ where: { id: tournamentId }, select: { configurationPolicy: true, format: true, style: true } });
  if (!event) throw new SecurityError('TOURNAMENT_NOT_FOUND', 404);
  assertNoPhase3Activation(event);
  if (activating && event.style !== 'Open Bracket') throw new SecurityError('ADVANCED_STYLE_NOT_AVAILABLE', 409);
  if (activating && ['2v2', '3v3'].includes(event.format)) throw new SecurityError('LEGACY_EVENT_REQUIRES_EXPLICIT_MIGRATION', 409);
  if (activating && !['1v1', '2v2', '3v3', '5v5'].includes(event.format)) throw new SecurityError('UNSUPPORTED_FORMAT', 409);
}
