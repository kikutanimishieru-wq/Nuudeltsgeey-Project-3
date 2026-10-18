import { assertTournamentIndependent } from './competition-authority';
import { assertCurrentPermission } from './transaction-authority';
import type { Prisma } from '@prisma/client';
import { assertIndependent, assertPermission } from './permissions';
import { SecurityError } from './security-error';

export async function assertCaseIndependence(tx: Prisma.TransactionClient, incidentId: string, reviewerId: string) {
  const incident = await tx.incident.findUnique({ where: { id: incidentId }, include: { parties: true } });
  if (!incident || incident.parties.length === 0) throw new SecurityError('REVIEW_CONTEXT_REQUIRED', 409);
  await assertTournamentIndependent(tx, reviewerId, incident.tournamentId);
  assertIndependent(reviewerId, [...incident.parties.map(party => party.userId), ...(incident.reporterId ? [incident.reporterId] : [])]);
  const parties = await tx.playerProfile.findMany({ where: { userId: { in: incident.parties.map(party => party.userId) } }, select: { currentTeamId: true } });
  const teamIds = parties.flatMap(p => p.currentTeamId ? [p.currentTeamId] : []);
  const competing = await tx.playerProfile.findFirst({ where: { userId: reviewerId, OR: [
    { tournamentRosters: { some: { registration: { tournamentId: incident.tournamentId } } } },
    { teamMemberships: { some: { leftAt: null, teamId: { in: teamIds } } } },
    { currentTeamId: { in: teamIds } },
  ] }, select: { id: true } });
  if (competing) throw new SecurityError('CONFLICT_OF_INTEREST');
  return incident;
}
export async function requireIndependentReviewer(tx: Prisma.TransactionClient, actor: { id: string; role: string; accountStatus: string }, incidentId: string, serious: boolean) {
  await assertCurrentPermission(tx, actor.id, serious ? 'REVIEW_SERIOUS' : 'REVIEW_MINOR');
  const incident = await assertCaseIndependence(tx, incidentId, actor.id);
  const assignment = await tx.reviewAssignment.findUnique({ where: { incidentId_reviewerId: { incidentId, reviewerId: actor.id } } });
  if (!assignment || assignment.assignedById === actor.id) throw new SecurityError('INDEPENDENT_ASSIGNMENT_REQUIRED', 409);
  await assertCaseIndependence(tx, incidentId, assignment.assignedById);
  const assigner = await tx.user.findUnique({ where: { id: assignment.assignedById }, select: { role: true, accountStatus: true } });
  if (!assigner) throw new SecurityError('INDEPENDENT_ASSIGNMENT_REQUIRED', 409);
  assertPermission(assigner, 'IDENTITY_REVIEW');
  return incident;
}
