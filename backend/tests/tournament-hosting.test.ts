import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../lib/prisma', () => ({ prisma: { $transaction: vi.fn() } }));
import { prisma } from '../lib/prisma';
import { createHostedTournament, archiveHostedDraft } from '../lib/tournament-hosting';
import { configurationPolicy } from '../lib/tournament-configuration';
const input = { name: 'Community Arena', venue: 'Verified Cafe', format: '5v5', capacity: 16 };
function db() { return { $queryRaw: vi.fn(), user: { findUnique: vi.fn().mockResolvedValue({ accountStatus: 'ACTIVE', profile: { id: 'profile' }, externalIdentities: ['STEAM','DISCORD'].map(provider => ({ provider, verifiedAt: new Date(), revokedAt: null })) }) },
  tournament: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockImplementation(({ data }) => ({ ...data, id: 'created' })), findUnique: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, auditEvent: { create: vi.fn() } }; }
let tx: ReturnType<typeof db>;
beforeEach(() => { vi.clearAllMocks(); tx = db(); vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(tx)); });
describe('verified community hosting', () => {
  it('creates a free draft owned by the authenticated player without joining the roster', async () => {
    const result = await createHostedTournament('player', input);
    expect(result).toMatchObject({ status: 'DRAFT', entryFee: 0, classification: { kind: null, activePlayerCount: null } });
    expect(tx.tournament.create.mock.calls[0][0].data).toMatchObject({ hostUserId: 'player', teamSize: 5, maxSubstitutes: 1, rulesVersion: 'OWNER_PHASE4_FINAL_2026_10_16' });
    expect(tx.$queryRaw).toHaveBeenCalledBefore(tx.tournament.count);
    expect(tx.auditEvent.create).toHaveBeenCalledOnce();
  });
  it('checks current identity inside the transaction despite earlier authentication', async () => {
    tx.user.findUnique.mockResolvedValue({ accountStatus: 'ACTIVE', profile: {}, externalIdentities: [] });
    await expect(createHostedTournament('player', input)).rejects.toThrow('COMPETITIVE_IDENTITY_REQUIRED');
    expect(tx.tournament.create).not.toHaveBeenCalled();
  });
  it('does not exempt administrators from the three-active-event limit', async () => {
    tx.tournament.count.mockResolvedValue(3);
    await expect(createHostedTournament('administrator', input)).rejects.toThrow('HOSTING_LIMIT_REACHED');
    expect(tx.tournament.create).not.toHaveBeenCalled();
  });
  it('rejects manual Grand classification and financial fields before mutation', async () => {
    await expect(createHostedTournament('player', { ...input, isGrandBattle: true })).rejects.toThrow('INVALID_TOURNAMENT_CONFIGURATION');
    await expect(createHostedTournament('player', { ...input, entryFee: 10 })).rejects.toThrow('INVALID_TOURNAMENT_CONFIGURATION');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each(['2v2','3v3'])('allows the approved single optional substitute for %s', async format => {
    expect(await createHostedTournament('player', { ...input, format })).toMatchObject({ maxSubstitutes: 1, substituteReadinessBlockers: [], readinessBlockers: ['SCHEDULE_REQUIRED_BEFORE_OPENING'] });
  });
  it('propagates audit failures so the mutation transaction cannot commit', async () => {
    tx.auditEvent.create.mockRejectedValue(new Error('audit failure'));
    await expect(createHostedTournament('player', input)).rejects.toThrow('audit failure');
  });
  it('archives only the authenticated owner\'s Phase 3 draft without deleting it', async () => {
    tx.tournament.findUnique.mockResolvedValue({ hostUserId: 'other', configurationPolicy, status: 'DRAFT' });
    await expect(archiveHostedDraft('player','event')).rejects.toThrow('TOURNAMENT_NOT_FOUND');
    tx.tournament.findUnique.mockResolvedValue({ hostUserId: 'player', configurationPolicy, status: 'LIVE' });
    await expect(archiveHostedDraft('player','event')).rejects.toThrow('ONLY_OWN_CONFIGURATION_DRAFT_CAN_BE_ARCHIVED');
    tx.tournament.findUnique.mockResolvedValue({ hostUserId: 'player', configurationPolicy, status: 'DRAFT' });
    expect(await archiveHostedDraft('player','event')).toEqual({ id: 'event', status: 'ARCHIVED' });
    expect(tx.tournament.updateMany.mock.calls[0][0].data).toEqual({ status: 'ARCHIVED' });
  });
});
