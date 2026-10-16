import type { Prisma } from '@prisma/client';
import { awardEligibleAchievements, ensureAchievementDefinitions } from '@/lib/achievements';

const awardValues = { PARTICIPATION: 5, CHAMPION: 50, RUNNER_UP: 30, SEMIFINALIST: 15 } as const;

export async function awardTournamentResults(tx: Prisma.TransactionClient, tournamentId: string, placements: Array<{ playerId: string; kind: keyof typeof awardValues }>) {
  await ensureAchievementDefinitions(tx);
  for (const placement of placements) {
    const delta = awardValues[placement.kind];
    const player = await tx.playerProfile.findUnique({ where: { id: placement.playerId } });
    if (!player) throw new Error('PLAYER_NOT_FOUND');
    const award = await tx.tournamentAward.createMany({ data: [{ tournamentId, playerId: placement.playerId, kind: placement.kind, nrDelta: delta }], skipDuplicates: true });
    if (award.count === 0) continue;
    await tx.ratingTransaction.create({ data: { playerId: placement.playerId, type: placement.kind === 'PARTICIPATION' ? 'PARTICIPATION' : 'ADMIN_ADJUSTMENT', delta, beforeNr: player.currentNr, afterNr: player.currentNr + delta, note: `Tournament ${placement.kind.toLowerCase()} award` } });
    await tx.playerProfile.update({ where: { id: placement.playerId }, data: { currentNr: { increment: delta }, tournamentsPlayed: placement.kind === 'PARTICIPATION' ? { increment: 1 } : undefined, tournamentsWon: placement.kind === 'CHAMPION' ? { increment: 1 } : undefined } });
    await awardEligibleAchievements(tx, placement.playerId);
    if (placement.kind === 'CHAMPION') {
      const achievement = await tx.achievement.findUnique({ where: { kind: 'CHAMPION' } });
      if (achievement) await tx.playerAchievement.createMany({ data: [{ playerId: placement.playerId, achievementId: achievement.id }], skipDuplicates: true });
    }
  }
}
