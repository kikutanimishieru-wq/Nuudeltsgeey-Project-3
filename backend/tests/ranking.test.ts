import { describe, expect, it } from 'vitest';
import { matchDelta } from '../lib/ranking';

describe('ranking policy', () => {
  it('protects Floors 1 and 2 from negative match-loss changes', () => {
    expect(matchDelta(1000, 900, 1, false)).toBeGreaterThanOrEqual(0);
    expect(matchDelta(1000, 900, 2, false)).toBeGreaterThanOrEqual(0);
  });

  it('allows Floor 3 losses to reduce ranking', () => {
    expect(matchDelta(1000, 900, 3, false)).toBeLessThan(0);
  });

  it('rewards beating a stronger opponent more than a weaker one', () => {
    expect(matchDelta(1000, 1400, 3, true)).toBeGreaterThan(matchDelta(1400, 1000, 3, true));
  });
});
