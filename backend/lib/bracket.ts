export type BracketMatch = {
  round: string;
  bracketOrder: number;
  teamAId: string | null;
  teamBId: string | null;
};

export type NextMatchPosition = {
  round: string;
  bracketOrder: number;
  slot: 'A' | 'B';
};

/** Resolves the next match slot for a locked winner in the generated layout. */
export function getNextMatchPosition(round: string, bracketOrder: number): NextMatchPosition | null {
  if (round === 'FINAL') return null;
  if (round === 'SEMIFINAL') return { round: 'FINAL', bracketOrder: 0, slot: bracketOrder % 2 === 0 ? 'A' : 'B' };
  const matchCount = Number(round.replace('ROUND_OF_', ''));
  if (!Number.isInteger(matchCount) || matchCount < 4) return null;
  const nextMatchCount = matchCount / 4;
  const nextRound = nextMatchCount === 1 ? 'FINAL' : nextMatchCount === 2 ? 'SEMIFINAL' : `ROUND_OF_${nextMatchCount * 2}`;
  return { round: nextRound, bracketOrder: Math.floor(bracketOrder / 2), slot: bracketOrder % 2 === 0 ? 'A' : 'B' };
}

function nextPowerOfTwo(value: number) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

/** Creates a system-owned single-elimination layout. No seed or opponent is caller-selected. */
export function buildSingleEliminationBracket(teamIds: string[], random: () => number = Math.random): BracketMatch[] {
  if (!Array.isArray(teamIds) || teamIds.length < 2) throw new Error('AT_LEAST_TWO_TEAMS_REQUIRED');
  const shuffled = [...new Set(teamIds)];
  if (shuffled.length !== teamIds.length) throw new Error('DUPLICATE_TEAM');
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  const bracketSize = nextPowerOfTwo(shuffled.length);
  const matches: BracketMatch[] = [];
  const firstRoundName = `ROUND_OF_${bracketSize}`;
  for (let index = 0; index < bracketSize / 2; index += 1) {
    matches.push({ round: firstRoundName, bracketOrder: index, teamAId: shuffled[index * 2] ?? null, teamBId: shuffled[index * 2 + 1] ?? null });
  }
  let roundSize = bracketSize / 2;
  let roundNumber = 1;
  while (roundSize > 1) {
    roundSize /= 2;
    roundNumber += 1;
    const round = roundSize === 1 ? 'FINAL' : roundSize === 2 ? 'SEMIFINAL' : `ROUND_OF_${roundSize * 2}`;
    for (let index = 0; index < roundSize; index += 1) matches.push({ round, bracketOrder: index, teamAId: null, teamBId: null });
  }
  return matches;
}
