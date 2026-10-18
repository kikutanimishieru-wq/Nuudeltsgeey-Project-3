import { z } from 'zod';
import { SecurityError } from './security-error';

export const configurationPolicy = 'PHASE3_FREE_OPEN_V1';
export const entrantCapacities = [2, 4, 8, 16, 32, 64] as const;
export const competitiveFormats = ['1v1', '2v2', '3v3', '5v5'] as const;
export type CompetitiveFormat = typeof competitiveFormats[number];
export const activeHostStatuses = ['DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN', 'ROSTER_LOCKED', 'LIVE'] as const;
export const createTournamentSchema = z.object({
  name: z.string().trim().min(3).max(100),
  venue: z.string().trim().min(3).max(160),
  format: z.enum(competitiveFormats),
  capacity: z.number().int().refine(value => entrantCapacities.includes(value as typeof entrantCapacities[number]), 'Unsupported entrant capacity'),
  style: z.literal('Open Bracket').default('Open Bracket'),
  entryFee: z.literal(0).default(0),
  startsAt: z.string().datetime({ offset: true }).optional(),
}).strict();
export type TournamentConfigurationInput = z.input<typeof createTournamentSchema>;
export function rosterConfiguration(format: CompetitiveFormat) {
  const starters = { '1v1': 1, '2v2': 2, '3v3': 3, '5v5': 5 }[format];
  return { starters, approvedSubstituteLimit: format === '1v1' ? 0 : 1 };
}
export function configurationReadiness(format: CompetitiveFormat) {
  return ['SCHEDULE_REQUIRED_BEFORE_OPENING'];
}
export function assertNoPhase3Activation(tournament: { configurationPolicy: string | null }) {
  if (tournament.configurationPolicy === configurationPolicy) throw new SecurityError('TOURNAMENT_ACTIVATION_NOT_AVAILABLE', 409);
}

// Only Phase 4 may construct these server-validated participation snapshots.
// This helper implements the threshold, not attendance or roster eligibility verification.
export type ClassificationTeam = { players: Array<{ playerId: string; activeStarter: boolean; verifiedEligible: boolean }> };
export function classifyVerifiedActiveStarters(format: CompetitiveFormat, teams: ClassificationTeam[]) {
  if (!competitiveFormats.includes(format)) throw new SecurityError('UNSUPPORTED_FORMAT', 400);
  const { starters } = rosterConfiguration(format);
  const ids = new Set<string>();
  for (const team of teams) {
    const active = team.players.filter(player => player.activeStarter);
    if (active.length !== starters || new Set(active.map(player => player.playerId)).size !== starters ||
        active.some(player => !player.playerId || !player.verifiedEligible)) throw new SecurityError('CLASSIFICATION_ELIGIBILITY_UNRESOLVED', 409);
    active.forEach(player => ids.add(player.playerId));
  }
  return { activePlayerCount: ids.size, classification: ids.size >= 64 ? 'GRAND_BATTLE' as const : 'ORDINARY' as const };
}
