import { describe, expect, it } from 'vitest';
import { getRankForNr } from '../lib/ranks';

describe('Mongolian visual rank mapping', () => {
  it('maps the demo starting rating to the Mingghan tier', () => {
    expect(getRankForNr(1000).tier).toBe(5);
  });

  it('does not change the numeric rating value', () => {
    expect(getRankForNr(1012).minimumNr).toBe(1000);
  });

  it('maps the highest visual tier without changing ranking policy', () => {
    expect(getRankForNr(30000).name).toBe('Их хаан');
  });
});
