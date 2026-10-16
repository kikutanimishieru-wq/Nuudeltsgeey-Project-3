// Configurable ranking policy. This is a pure helper for future server use;
// browser clients must not be trusted to award ranking.
const DEFAULT_RANKING_POLICY = Object.freeze({
  protectedThroughFloor: 2,
  participationBonus: 2,
  winBase: 10,
  lossBase: 10,
  strongerOpponentStep: 6,
  weakerOpponentStep: 3,
  maxWinBonus: 18,
  maxLossBonus: 12,
  tournamentBonuses: Object.freeze({
    participation: 5,
    champion: 50,
    runnerUp: 30,
    semifinalist: 15,
  }),
});

const finite = value => Number.isFinite(Number(value));

/**
 * Return the rank-point delta for one verified match.
 *
 * A higher-ranked opponent is a stronger reward for a win. Losing after
 * Floor 2 can reduce rank. Floors 1–2 never receive a negative delta and
 * may progress slowly through verified participation.
 */
function calculateRankDelta({
  playerRank,
  opponentRank,
  floor,
  result,
  policy = DEFAULT_RANKING_POLICY,
}) {
  if (![playerRank, opponentRank, floor].every(finite)) throw new Error('INVALID_RANK_INPUT');
  if (!['win', 'loss'].includes(result)) throw new Error('INVALID_MATCH_RESULT');

  const difference = Number(opponentRank) - Number(playerRank);
  const participation = Number(policy.participationBonus);

  if (result === 'win') {
    const strengthBonus = difference >= 0
      ? Math.min(Number(policy.maxWinBonus), Math.floor(difference / 100) * Number(policy.strongerOpponentStep))
      : -Math.min(Number(policy.maxLossBonus), Math.floor(Math.abs(difference) / 100) * Number(policy.weakerOpponentStep));
    return Math.max(1, Number(policy.winBase) + strengthBonus + participation);
  }

  const loss = Number(policy.lossBase) + (difference < 0
    ? Math.min(Number(policy.maxLossBonus), Math.floor(Math.abs(difference) / 100) * Number(policy.weakerOpponentStep))
    : 0);
  const delta = participation - loss;
  return Number(floor) <= Number(policy.protectedThroughFloor) ? Math.max(0, delta) : delta;
}

function applyRankDelta(rank, delta) {
  if (!finite(rank) || !finite(delta)) throw new Error('INVALID_RANK_VALUE');
  return Math.max(0, Math.round(Number(rank) + Number(delta)));
}

function getRankingStatus(verifiedMatches, placementMatches = 5) {
  if (!Number.isSafeInteger(Number(verifiedMatches)) || Number(verifiedMatches) < 0) {
    throw new Error('INVALID_MATCH_COUNT');
  }
  if (!Number.isSafeInteger(Number(placementMatches)) || Number(placementMatches) < 1) {
    throw new Error('INVALID_PLACEMENT_COUNT');
  }
  const matches = Number(verifiedMatches);
  return {
    status: matches < placementMatches ? 'PLACEMENT' : 'OFFICIAL',
    startingRank: 1000,
    verifiedMatches: matches,
    matchesRemaining: Math.max(0, placementMatches - matches),
  };
}

function getTournamentBonus(kind, policy = DEFAULT_RANKING_POLICY) {
  const values = policy.tournamentBonuses;
  if (!values || !Object.prototype.hasOwnProperty.call(values, kind)) throw new Error('INVALID_TOURNAMENT_AWARD');
  return Number(values[kind]);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEFAULT_RANKING_POLICY, calculateRankDelta, applyRankDelta, getRankingStatus, getTournamentBonus };
}
