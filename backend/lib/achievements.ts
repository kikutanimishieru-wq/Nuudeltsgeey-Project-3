import type { Prisma } from '@prisma/client';

const definitions = [
  ['FIRST_STEP', 'First Step', 'Complete the first verified match.'],
  ['FIRST_BLOOD', 'First Blood', 'Win the first verified match.'],
  ['VETERAN', 'Veteran', 'Complete 10 verified matches.'],
  ['BATTLE_TESTED', 'Battle Tested', 'Complete 25 verified matches.'],
  ['FIFTY_BATTLES', '50 Battles', 'Complete 50 verified matches.'],
  ['STREAK_III', 'Streak III', 'Win three matches consecutively.'],
  ['STREAK_V', 'Streak V', 'Win five matches consecutively.'],
  ['CHAMPION', 'Champion', 'Win an official tournament.'],
  ['KHAN', 'Khan', 'Reach 1,400 NR.'],
] as const;

export async function ensureAchievementDefinitions(tx: Prisma.TransactionClient) {
  for (const [kind, name, description] of definitions) {
    await tx.achievement.upsert({ where: { kind }, create: { kind, name, description }, update: { name, description } });
  }
}

export async function awardEligibleAchievements(tx: Prisma.TransactionClient, playerId: string) {
  const player = await tx.playerProfile.findUnique({ where: { id: playerId } });
  if (!player) return;
  const eligible = new Set<string>();
  if (player.verifiedMatches >= 1) eligible.add('FIRST_STEP');
  if (player.wins >= 1) eligible.add('FIRST_BLOOD');
  if (player.verifiedMatches >= 10) eligible.add('VETERAN');
  if (player.verifiedMatches >= 25) eligible.add('BATTLE_TESTED');
  if (player.verifiedMatches >= 50) eligible.add('FIFTY_BATTLES');
  if (player.bestStreak >= 3) eligible.add('STREAK_III');
  if (player.bestStreak >= 5) eligible.add('STREAK_V');
  if (player.currentNr >= 1400) eligible.add('KHAN');
  for (const kind of eligible) {
    const achievement = await tx.achievement.findUnique({ where: { kind: kind as never } });
    if (achievement) await tx.playerAchievement.createMany({ data: [{ playerId, achievementId: achievement.id }], skipDuplicates: true });
  }
}
