import { describe, expect, it } from 'vitest';
import { buildSingleEliminationBracket, getNextMatchPosition } from '../lib/bracket';

describe('single-elimination bracket generation', () => {
  it('creates a flexible eight-team bracket without manual pairing', () => {
    const result = buildSingleEliminationBracket(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], () => 0.5);
    expect(result).toHaveLength(7);
    expect(result.filter((match) => match.round === 'ROUND_OF_8')).toHaveLength(4);
    expect(result.filter((match) => match.round === 'FINAL')).toHaveLength(1);
  });

  it('supports non-power-of-two fields with byes', () => {
    const result = buildSingleEliminationBracket(['a', 'b', 'c'], () => 0.5);
    expect(result.filter((match) => match.round === 'ROUND_OF_4')).toHaveLength(2);
    expect(result.some((match) => match.teamAId === null || match.teamBId === null)).toBe(true);
  });

  it('rejects duplicate teams', () => {
    expect(() => buildSingleEliminationBracket(['a', 'a'])).toThrow('DUPLICATE_TEAM');
  });

  it('advances round-of-eight winners into the correct semifinal slots', () => {
    expect(getNextMatchPosition('ROUND_OF_8', 0)).toEqual({ round: 'SEMIFINAL', bracketOrder: 0, slot: 'A' });
    expect(getNextMatchPosition('ROUND_OF_8', 1)).toEqual({ round: 'SEMIFINAL', bracketOrder: 0, slot: 'B' });
    expect(getNextMatchPosition('ROUND_OF_8', 2)).toEqual({ round: 'SEMIFINAL', bracketOrder: 1, slot: 'A' });
  });

  it('advances semifinal winners into the final', () => {
    expect(getNextMatchPosition('SEMIFINAL', 0)).toEqual({ round: 'FINAL', bracketOrder: 0, slot: 'A' });
    expect(getNextMatchPosition('SEMIFINAL', 1)).toEqual({ round: 'FINAL', bracketOrder: 0, slot: 'B' });
  });
});
