export const rankingPolicy = {
  protectedThroughFloor: 2,
  participationBonus: 2,
  winBase: 10,
  lossBase: 10,
  strongerOpponentStep: 6,
  weakerOpponentStep: 3,
  maxWinBonus: 18,
  maxLossBonus: 12,
} as const;

export function matchDelta(playerNr: number, opponentNr: number, floor: number, won: boolean) {
  const difference = opponentNr - playerNr;
  if (won) {
    const modifier = difference >= 0
      ? Math.min(rankingPolicy.maxWinBonus, Math.floor(difference / 100) * rankingPolicy.strongerOpponentStep)
      : -Math.min(rankingPolicy.maxLossBonus, Math.floor(Math.abs(difference) / 100) * rankingPolicy.weakerOpponentStep);
    return Math.max(1, rankingPolicy.winBase + modifier + rankingPolicy.participationBonus);
  }
  const loss = rankingPolicy.lossBase + (difference < 0
    ? Math.min(rankingPolicy.maxLossBonus, Math.floor(Math.abs(difference) / 100) * rankingPolicy.weakerOpponentStep)
    : 0);
  const delta = rankingPolicy.participationBonus - loss;
  return floor <= rankingPolicy.protectedThroughFloor ? Math.max(0, delta) : delta;
}
