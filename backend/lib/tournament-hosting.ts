import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { assertCompetitiveIdentity } from './permissions';
import { lockIdentityUser } from './identity';
import { writeAudit } from './audit';
import { SecurityError } from './security-error';
import { attendanceRuleVersion } from './tournament-attendance-policy';
import { configurationPolicy, createTournamentSchema, rosterConfiguration, activeHostStatuses } from './tournament-configuration';

export const ownedConfigurationSelect = {
  id: true, name: true, venue: true, format: true, style: true, capacity: true,
  startsAt: true, status: true, configurationPolicy: true, entryFee: true, rulesVersion: true,
  registrationPolicy: { select: { registrationClosesAt: true, deadlineApprovalRef: true, attendancePolicyRef: true, rulesVersion: true } },
  lockSnapshot: { select: { classification: true, activePlayerCount: true, lockedAt: true, digest: true } },
} satisfies Prisma.TournamentSelect;
export type OwnedConfiguration = Prisma.TournamentGetPayload<{ select: typeof ownedConfigurationSelect }>;
export function configurationResponse(tournament: OwnedConfiguration) {
  if (tournament.configurationPolicy !== configurationPolicy) return { ...tournament, managedByCurrentConfiguration: false };
  const roster = rosterConfiguration(tournament.format as '1v1' | '2v2' | '3v3' | '5v5');
  return { ...tournament, managedByCurrentConfiguration: true,
    capacityUnit: tournament.format === '1v1' ? 'PLAYERS' : 'TEAMS',
    startersPerEntrant: roster.starters, maxSubstitutes: tournament.rulesVersion !== attendanceRuleVersion && ['2v2','3v3'].includes(tournament.format) ? null : roster.approvedSubstituteLimit,
    substituteReadinessBlockers: [],
    readinessBlockers: [
      ...(!tournament.startsAt ? ['SCHEDULE_REQUIRED_BEFORE_OPENING'] : []),
      ...(tournament.status !== 'DRAFT' && tournament.rulesVersion !== attendanceRuleVersion ? ['HISTORICAL_POLICY_REQUIRES_EXPLICIT_REVIEW'] : []),
    ],
    classification: tournament.lockSnapshot ?? { status: 'AWAITING_LOCK_SNAPSHOT', kind: null, activePlayerCount: null, threshold: 64 },
  };
}
export async function createHostedTournament(actorId: string, raw: unknown) {
  const parsed = createTournamentSchema.safeParse(raw);
  if (!parsed.success) throw new SecurityError('INVALID_TOURNAMENT_CONFIGURATION', 400);
  if (parsed.data.startsAt && new Date(parsed.data.startsAt) <= new Date()) throw new SecurityError('START_MUST_BE_IN_FUTURE', 400);
  const input = parsed.data;
  return prisma.$transaction(async tx => {
    await lockIdentityUser(tx, actorId);
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: {
      accountStatus: true, profile: { select: { id: true } }, externalIdentities: { select: {
        provider: true, verifiedAt: true, revokedAt: true, administrativeHoldAt: true, revocationKind: true,
      } },
    } });
    if (!actor || !actor.profile) throw new SecurityError('COMPETITIVE_IDENTITY_REQUIRED');
    assertCompetitiveIdentity(actor);
    const active = await tx.tournament.count({ where: { hostUserId: actorId, status: { in: [...activeHostStatuses] } } });
    if (active >= 3) throw new SecurityError('HOSTING_LIMIT_REACHED', 409);
    const roster = rosterConfiguration(input.format);
    const tournament = await tx.tournament.create({ data: {
      hostUserId: actorId, configurationPolicy, entryFee: 0, game: 'Counter-Strike 2',
      name: input.name, venue: input.venue, format: input.format, capacity: input.capacity, style: input.style,
      teamSize: roster.starters, startersPerTeam: roster.starters,
      maxSubstitutes: roster.approvedSubstituteLimit,
      rulesVersion: attendanceRuleVersion, status: 'DRAFT', startsAt: input.startsAt ? new Date(input.startsAt) : null,
    }, select: ownedConfigurationSelect });
    await writeAudit(tx, { actorId, action: 'TOURNAMENT_CONFIGURATION_CREATED', entityType: 'Tournament', entityId: tournament.id,
      tournamentId: tournament.id, metadata: { configurationPolicy, format: input.format, capacity: input.capacity, entryFee: 0 } });
    return configurationResponse(tournament);
  }, { isolationLevel: 'ReadCommitted' });
}
export async function archiveHostedDraft(actorId: string, tournamentId: string) {
  return prisma.$transaction(async tx => {
    await lockIdentityUser(tx, actorId);
    const current = await tx.tournament.findUnique({ where: { id: tournamentId }, select: { hostUserId: true, configurationPolicy: true, status: true } });
    if (!current || current.hostUserId !== actorId) throw new SecurityError('TOURNAMENT_NOT_FOUND', 404);
    if (current.configurationPolicy !== configurationPolicy || current.status !== 'DRAFT') throw new SecurityError('ONLY_OWN_CONFIGURATION_DRAFT_CAN_BE_ARCHIVED', 409);
    const changed = await tx.tournament.updateMany({ where: { id: tournamentId, hostUserId: actorId, status: 'DRAFT', configurationPolicy }, data: { status: 'ARCHIVED' } });
    if (changed.count !== 1) throw new SecurityError('CONFIGURATION_CHANGED', 409);
    await writeAudit(tx, { actorId, action: 'TOURNAMENT_DRAFT_ARCHIVED', entityType: 'Tournament', entityId: tournamentId, tournamentId });
    return { id: tournamentId, status: 'ARCHIVED' };
  }, { isolationLevel: 'ReadCommitted' });
}
