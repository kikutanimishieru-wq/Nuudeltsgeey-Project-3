import { describe, it, expect } from 'vitest';
import { createTournamentSchema, competitiveFormats, entrantCapacities, rosterConfiguration, classifyVerifiedActiveStarters, assertNoPhase3Activation, configurationPolicy } from '../lib/tournament-configuration';
const base = { name: 'Verified Open', venue: 'Local Arena', format: '5v5', capacity: 16 };
describe('Phase 3 tournament configuration', () => {
  it.each(competitiveFormats.flatMap(format => entrantCapacities.map(capacity => [format, capacity] as const)))('accepts %s with %s entrants as configuration', (format, capacity) => {
    expect(createTournamentSchema.parse({ ...base, format, capacity })).toMatchObject({ format, capacity, entryFee: 0, style: 'Open Bracket' });
  });
  it.each([0,1,3,6,12,65,128,2.5])('rejects unsupported capacity %s', capacity => {
    expect(createTournamentSchema.safeParse({ ...base, capacity }).success).toBe(false);
  });
  it.each([
    { hostUserId: 'other' }, { status: 'LIVE' }, { classification: 'GRAND_BATTLE' }, { isGrandBattle: true },
    { category: 'Grand Battle' }, { entryFee: 1 }, { tokenStakes: 0 }, { rankWeight: 2 }, { opponents: ['a','b'] },
    { style: 'Swiss System' }, { style: 'Token Battle Mode' }, { format: '4v4' }, { rulesVersion: 'invented' },
  ])('rejects host-controlled or unsupported fields %j', input => {
    expect(createTournamentSchema.safeParse({ ...base, ...input }).success).toBe(false);
  });
  it('enforces the final approved single optional team substitute', () => {
    expect(rosterConfiguration('5v5')).toEqual({ starters: 5, approvedSubstituteLimit: 1 });
    expect(rosterConfiguration('3v3')).toEqual({ starters: 3, approvedSubstituteLimit: 1 });
    expect(rosterConfiguration('2v2')).toEqual({ starters: 2, approvedSubstituteLimit: 1 });
  });
  it('keeps every newly configured tournament inactive until Phase 4', () => {
    expect(() => assertNoPhase3Activation({ configurationPolicy })).toThrow('TOURNAMENT_ACTIVATION_NOT_AVAILABLE');
    expect(() => assertNoPhase3Activation({ configurationPolicy: null })).not.toThrow();
  });
});
const field = (teams: number, size: number, bench = false) => Array.from({ length: teams }, (_, t) => ({ players: [
  ...Array.from({ length: size }, (_, p) => ({ playerId: `team-${t}-player-${p}`, activeStarter: true, verifiedEligible: true })),
  ...(bench ? [{ playerId: `bench-${t}`, activeStarter: false, verifiedEligible: true }] : []),
] }));
describe('automatic active-starter classification policy (not finalization)', () => {
  it.each([
    ['1v1',64,1,64,'GRAND_BATTLE'], ['2v2',32,2,64,'GRAND_BATTLE'],
    ['3v3',16,3,48,'ORDINARY'], ['3v3',32,3,96,'GRAND_BATTLE'],
    ['5v5',8,5,40,'ORDINARY'], ['5v5',16,5,80,'GRAND_BATTLE'],
  ] as const)('classifies %s from actual starters', (format, teams, size, activePlayerCount, classification) => {
    expect(classifyVerifiedActiveStarters(format, field(teams, size))).toEqual({ activePlayerCount, classification });
  });
  it('counts each identity once and excludes unused bench players', () => {
    const teams = field(8,5,true);
    expect(classifyVerifiedActiveStarters('5v5', teams).activePlayerCount).toBe(40);
    const solos = field(64,1); solos[63].players[0].playerId = solos[0].players[0].playerId;
    expect(classifyVerifiedActiveStarters('1v1', solos)).toEqual({ activePlayerCount: 63, classification: 'ORDINARY' });
  });
  it('counts a substitute only when occupying a valid active starter position', () => {
    const teams = field(16,5,true); teams[0].players[0].activeStarter = false; teams[0].players[5].activeStarter = true;
    expect(classifyVerifiedActiveStarters('5v5', teams).activePlayerCount).toBe(80);
  });
  it('does not infer eligibility for incomplete or unverified teams', () => {
    expect(() => classifyVerifiedActiveStarters('3v3', field(1,2))).toThrow('CLASSIFICATION_ELIGIBILITY_UNRESOLVED');
    const teams = field(1,5); teams[0].players[0].verifiedEligible = false;
    expect(() => classifyVerifiedActiveStarters('5v5', teams)).toThrow('CLASSIFICATION_ELIGIBILITY_UNRESOLVED');
  });
});
