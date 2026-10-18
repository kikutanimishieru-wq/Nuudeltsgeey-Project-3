import type { Prisma } from '@prisma/client';
import { assertCompetitiveIdentity } from './permissions';
import { SecurityError } from './security-error';

export async function assertTournamentIndependent(tx: Prisma.TransactionClient, actorId: string, tournamentId: string) {
  const event = await tx.tournament.findUnique({ where: { id: tournamentId }, select: { hostUserId: true } });
  if (event?.hostUserId === actorId) throw new SecurityError('CONFLICT_OF_INTEREST');
  const participant = await tx.playerProfile.findFirst({ where: { userId: actorId,
    tournamentRosters: { some: { registration: { tournamentId } } } }, select: { id: true } });
  if (participant) throw new SecurityError('CONFLICT_OF_INTEREST');
}
export async function assertRosterIdentities(tx: Prisma.TransactionClient, tournamentId: string, registrationId?: string) {
  const members = await tx.tournamentRosterMember.findMany({ where: { registration: { tournamentId,
    ...(registrationId ? { id: registrationId } : { status: 'APPROVED' }) } }, select: { player: { select: { userId: true } } } });
  const ids = [...new Set(members.map(member => member.player.userId))].sort();
  // Stable lock ordering serializes revocation with protected roster/result operations.
  for (const id of ids) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
  const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { accountStatus: true,
    externalIdentities: { select: { provider: true, verifiedAt: true, revokedAt: true, administrativeHoldAt: true, revocationKind: true } } } });
  if (users.length !== ids.length) throw new SecurityError('COMPETITIVE_IDENTITY_REQUIRED');
  users.forEach(assertCompetitiveIdentity);
}
