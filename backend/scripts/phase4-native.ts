/** PREPARED ONLY. Native fixtures commit; branch disposal requires separate approval. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID, createHash } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
vi.mock('../lib/prisma', () => ({ prisma: { $transaction: vi.fn() } }));
import { prisma } from '../lib/prisma';
import { registerEntrant, checkInPlayer, recordLatenessClaim, editRoster, finalizeTournament, withdrawEntrant } from '../lib/tournament-registration';
import { attendanceRuleVersion, selfAttendancePolicy } from '../lib/tournament-attendance-policy';

const budgets = require('./phase4-budgets.cjs');
const duplicate = require('./phase4-duplicate-check.cjs');
const SafeReporter = require('./phase4-reporter.cjs');
const duplicateSql = require('./phase4-duplicate-sql.cjs');
// Project rough-snow-56584532 is checked live by the shared launcher guard.
const branch = 'br-withered-mode-b528hnhk';
const endpoint = 'ep-delicate-poetry-b5bbwllj';
const hostname = endpoint + '.c-7.us-east-2.aws.neon.tech';
const expiresAt = '2026-10-26T09:48:09Z';
const rejectedBranches = new Set(['br-wispy-mountain-b5nku4bf', 'br-plain-glitter-b5cadax8', 'br-morning-queen-b5u7j4qz']);
if (rejectedBranches.has(process.env.PHASE4_NATIVE_AUTHORIZED ?? '')) throw Error('NATIVE_TARGET_REJECTED');
const url = process.env.PHASE4_VALIDATION_DATABASE_URL;
if (process.env.PHASE4_NATIVE_AUTHORIZED !== branch || !url) throw Error('NATIVE_EXECUTION_NOT_AUTHORIZED');
const parsed = new URL(url);
if (parsed.hostname !== hostname || parsed.pathname !== '/neondb' || parsed.username !== 'neondb_owner' || parsed.searchParams.get('sslmode') !== 'require' || parsed.searchParams.get('sslaccept') !== 'strict') throw Error('NATIVE_TARGET_REJECTED');
const run = process.env.PHASE4_RUN_ID!;
if (!/^p4_[a-f0-9]{16}$/.test(run)) throw Error('NATIVE_RUN_ID_REQUIRED');
function unexpired() {
  const expiry = Date.parse(process.env.PHASE4_EXPIRES_AT ?? '');
  if (!Number.isFinite(expiry) || expiry !== Date.parse(expiresAt) || expiry - Date.now() < 600000) throw Error('NATIVE_BRANCH_EXPIRY');
}
const clients = Array.from({ length: 3 }, () => new PrismaClient({ datasources: { db: { url } }, log: [] }));
const db = clients[0];
const context = new AsyncLocalStorage<{ client: PrismaClient; barrier?: () => Promise<void>; pids?: number[]; lockEvent?: string; timeout?: number }>();
const id = () => `${run}_${randomUUID()}`;
const solo = (p: { id: string }) => ({ roster: [{ playerId: p.id, isStarter: true }] });
type Player = { id: string; userId: string };
async function time() { return (await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now; }
async function transaction<T>(client: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>, isolation: Prisma.TransactionIsolationLevel = 'ReadCommitted', timeout = budgets.winnerTransaction) {
  unexpired();
  return client.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(budgets.statement)}, true)`;
    await tx.$queryRaw`SELECT set_config('lock_timeout', ${String(budgets.lock)}, true)`;
    return fn(tx);
  }, { isolationLevel: isolation, timeout, maxWait: budgets.pool });
}
function barrier() {
  let count = 0, release!: () => void;
  const ready = new Promise<void>(r => { release = r; });
  return async () => {
    if (++count === 2) release();
    let timer: ReturnType<typeof setTimeout>;
    try { await Promise.race([ready, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('BARRIER_TIMEOUT')), budgets.barrier); })]); }
    finally { clearTimeout(timer!); }
  };
}
async function race<T>(eventId: string, left: () => Promise<T>, right: () => Promise<T>) {
  const gate = barrier(), pids: number[] = [];
  const results = await Promise.allSettled([left, right].map((fn, i) => context.run({ client: clients[i + 1], barrier: gate, pids, lockEvent: i === 0 ? eventId : undefined, timeout: i === 0 ? budgets.winnerTransaction : budgets.waiterTransaction }, fn)));
  expect(pids).toHaveLength(2); expect(new Set(pids).size).toBe(2);
  // Distinct native sessions are asserted; do not log fixture or error content.
  return results;
}
async function player(floor = 1, role: 'PLAYER' | 'REFEREE' = 'PLAYER'): Promise<Player> {
  const userId = id(), profileId = id(), seed = BigInt('0x' + createHash('sha256').update(userId).digest('hex').slice(0, 14));
  await db.user.create({ data: { id: userId, email: `${userId}@example.invalid`, passwordHash: 'SYNTHETIC_DISABLED_LOGIN', publicNmdId: userId, role, accountStatus: 'ACTIVE',
    profile: { create: { id: profileId, nickname: profileId, floor } },
    externalIdentities: { create: ['STEAM', 'DISCORD'].map((provider, i) => ({ provider: provider as 'STEAM' | 'DISCORD', providerAccountId: String(BigInt('10000000000000000') + seed + BigInt(i)), verifiedAt: new Date() })) },
  } });
  return { id: profileId, userId };
}
async function bulkPlayers(count: number): Promise<Player[]> {
  const players = Array.from({ length: count }, () => ({ id: id(), userId: id() }));
  await db.$transaction([
    db.user.createMany({ data: players.map(p => ({ id: p.userId, email: `${p.userId}@example.invalid`, passwordHash: 'SYNTHETIC_DISABLED_LOGIN', publicNmdId: p.userId, accountStatus: 'ACTIVE' as const })) }),
    db.playerProfile.createMany({ data: players.map(p => ({ id: p.id, userId: p.userId, nickname: p.id, floor: 1 })) }),
    db.externalIdentity.createMany({ data: players.flatMap(p => ['STEAM', 'DISCORD'].map((provider, i) => ({ userId: p.userId, provider: provider as 'STEAM' | 'DISCORD', verifiedAt: new Date(), providerAccountId: String(BigInt('10000000000000000') + BigInt('0x' + createHash('sha256').update(p.userId).digest('hex').slice(0, 14)) + BigInt(i)) }))) }),
  ]);
  return players;
}

async function event(capacity = 2, format = '1v1') {
  const host = await player(), size = Number(format[0]);
  const startsAt = new Date((await time()).getTime() + 3600000), eventId = id();
  await db.tournament.create({ data: { id: eventId, name: eventId, venue: 'Synthetic validation only', format, style: 'Open Bracket', capacity,
    teamSize: size, startersPerTeam: size, maxSubstitutes: size === 1 ? 0 : 1, hostUserId: host.userId,
    configurationPolicy: 'PHASE3_FREE_OPEN_V1', entryFee: 0, status: 'REGISTRATION_OPEN', rulesVersion: attendanceRuleVersion, startsAt,
    registrationPolicy: { create: { registrationClosesAt: new Date(startsAt.getTime() - 900000), deadlineApprovalRef: attendanceRuleVersion, rulesVersion: attendanceRuleVersion, attendancePolicyRef: selfAttendancePolicy } },
  } });
  return eventId;
}
async function schedule(eventId: string, offset: number) {
  const startsAt = new Date((await time()).getTime() + offset);
  await db.$transaction([
    db.tournament.update({ where: { id: eventId }, data: { startsAt } }),
    db.tournamentRegistrationPolicy.update({ where: { tournamentId: eventId }, data: { registrationClosesAt: new Date(startsAt.getTime() - 900000) } }),
  ]);
}
async function team(players: Player[]) {
  const teamId = id();
  await db.team.create({ data: { id: teamId, name: teamId, captainId: players[0].id,
    memberships: { create: players.map(p => ({ playerId: p.id })) } } });
  return teamId;
}
async function seedStarters(eventId: string, players: Player[], attended = false) {
  const e = await db.tournament.findUniqueOrThrow({ where: { id: eventId } });
  const entries = players.map(p => ({ id: id(), tournamentId: eventId, soloPlayerId: p.id, status: 'APPROVED' as const }));
  await db.$transaction([
    db.tournamentRegistration.createMany({ data: entries }),
    db.tournamentRosterMember.createMany({ data: entries.map((r, i) => ({ id: id(), registrationId: r.id, playerId: players[i].id,
      checkedInAt: attended ? new Date(e.startsAt!.getTime() - 60000) : null, checkInRuleVersion: attended ? attendanceRuleVersion : null })) }),
  ]);
}
async function auditCount(eventId: string, action: string) { return db.auditEvent.count({ where: { tournamentId: eventId, action } }); }

beforeAll(async () => {
  unexpired();
  const [identity] = await db.$queryRaw<Array<{ database: string; role: string }>>`SELECT current_database() AS database, current_user AS role`;
  expect(identity).toEqual({ database: 'neondb', role: 'neondb_owner' });
  // Fail before fixtures if any application records already exist, including prior failed runs.
  const tables = await db.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations'`;
  expect(tables).toHaveLength(37);
  for (const { table_name } of tables) {
    if (!/^[A-Za-z]+$/.test(table_name)) throw Error('UNEXPECTED_TABLE');
    const [row] = await db.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) FROM public."${table_name}"`);
    expect(Number(row.count), 'branch must contain no application rows before this run').toBe(0);
  }
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    const request = context.getStore();
    return transaction(request?.client ?? db, async tx => {
      if (request?.barrier) {
        const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        request.pids!.push(row.pid);
        // Chosen winner holds the event lock before either contender starts service work.
        if (request.lockEvent) await tx.$queryRaw`SELECT id FROM "Tournament" WHERE id=${request.lockEvent} FOR UPDATE`;
        await request.barrier();
      }
      return fn(tx);
    }, 'ReadCommitted', request?.timeout ?? budgets.winnerTransaction);
  }) as any);
});
beforeEach(unexpired);
afterAll(async () => { await Promise.all(clients.map(client => client.$disconnect())); });

describe.sequential('Phase 4 native isolated behavior — explicit authorization required', () => {
  it('serializes service registrations at the last capacity slot with atomic audit', async () => {
    const e = await event(), a = await player(), b = await player(), c = await player();
    await registerEntrant(a.userId, e, solo(a));
    const result = await race(e, () => registerEntrant(b.userId, e, solo(b)), () => registerEntrant(c.userId, e, solo(c)));
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const failed = result.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(failed.reason)).toContain('TOURNAMENT_CAPACITY_REACHED');
    expect(await db.tournamentRegistration.count({ where: { tournamentId: e } })).toBe(2);
    expect(await auditCount(e, 'ENTRANT_REGISTERED')).toBe(2);
    await expect(registerEntrant(a.userId, e, solo(a))).rejects.toThrow('DUPLICATE_TOURNAMENT_PARTICIPATION');
  });
  it('rejects duplicate participation across teams in direct concurrent transactions', async () => {
    const e = await event(2, '2v2'), shared = await player(), a = await player(), b = await player();
    const teams = await Promise.all([team([a, shared]), team([b, shared])]);
    const emit = (stage: string, details: Record<string, unknown> = {}) => new SafeReporter().write(duplicate.safeStage(stage, details));
    const [triggerState] = await db.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND t.tgenabled='O' AND ((c.relname='TournamentRegistration' AND t.tgname='registration_lock_guard' AND p.proname='guard_tournament_registration_write') OR (c.relname='TournamentRosterMember' AND t.tgname='roster_lock_guard' AND p.proname='guard_tournament_registration_write') OR (c.relname='TournamentRegistration' AND t.tgname='phase4_capacity_and_participation_registration' AND p.proname='enforce_phase4_entrant_invariants') OR (c.relname='TournamentRosterMember' AND t.tgname='phase4_capacity_and_participation_roster' AND p.proname='enforce_phase4_entrant_invariants'))`;
    const fixtureValid = teams.length === 2 && new Set(teams).size === 2
      && await db.teamMembership.count({ where: { teamId: { in: teams }, playerId: shared.id, leftAt: null } }) === 2
      && await db.tournamentRegistration.count({ where: { tournamentId: e } }) === 0;
    emit('FIXTURE_CONTEXT', { fixture_valid: fixtureValid, trigger_verified: triggerState.count === 4 });
    expect(fixtureValid, 'P4_DUP_FIXTURE_CONTEXT').toBe(true);
    expect(triggerState.count, 'P4_DUP_TRIGGER_CONTEXT').toBe(4);
    const gate = barrier(), pids: number[] = [];
    const result = await Promise.allSettled(teams.map((teamId, i) => transaction(clients[i + 1], async tx => {
      pids.push((await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid);
      emit('SESSION_STARTED', { session_ids: pids });
      await gate();
      const registration = await tx.tournamentRegistration.create({ data: { tournamentId: e, teamId, status: 'APPROVED' } });
      // Only bound fixture JSON enters transaction-local settings; fixed SQL adds no schema objects.
      await tx.$queryRaw`SELECT set_config('phase4.duplicate_fixture', ${JSON.stringify({ id: id(), registrationId: registration.id, playerId: shared.id })}, true)`;
      // The pinned engine preserves 23505 DETAIL, but drops a message-only trigger exception.
      // This constant block tags only the exact original rule/context, then aborts the outer tx.
      await tx.$executeRawUnsafe(duplicateSql.sql);
    })));
    const rejected = result.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    const details = { session_ids: pids, distinct_sessions: pids.length === 2 && new Set(pids).size === 2,
      outcomes: result.map(r => r.status), fulfilled_count: result.filter(r => r.status === 'fulfilled').length,
      rejected_count: rejected.length, rejections: rejected.map(r => duplicate.facts(r.reason)) };
    emit('TRANSACTION_OUTCOMES', details);
    emit('DISTINCT_SESSIONS', details);
    expect(details.distinct_sessions, 'P4_DUP_DISTINCT_SESSIONS').toBe(true);
    emit('ONE_COMMIT', details);
    expect(details.fulfilled_count, 'P4_DUP_ONE_COMMIT').toBe(1);
    expect(details.rejected_count, 'P4_DUP_ONE_REJECTION').toBe(1);
    emit('DATABASE_POSTCONDITIONS');
    const entries = await db.tournamentRegistration.findMany({ where: { tournamentId: e }, select: { teamId: true, roster: { select: { playerId: true } } } });
    const roster = entries.flatMap(entry => entry.roster);
    const post = { registration_count: entries.length, roster_count: roster.length,
      duplicate_count: roster.length - new Set(roster.map(member => member.playerId)).size,
      winner_team_valid: entries.every(entry => entry.teamId === teams[result.findIndex(r => r.status === 'fulfilled')]),
      shared_player_only: roster.every(member => member.playerId === shared.id) };
    emit('DATABASE_POSTCONDITIONS', post);
    expect(duplicate.validPostconditions(post), 'P4_DUP_DATABASE_POSTCONDITIONS').toBe(true);
    emit('REJECTION_CONTEXT', details);
    expect(duplicate.expectedRejection(details.rejections[0]), 'P4_DUP_EXPECTED_REJECTION').toBe(true);
    emit('COMPLETE', { ...details, ...post });
  });
  it('requires verified eligible identities and enforces optional substitute limits for 2v2/3v3/5v5', async () => {
    const invalid = await player();
    await db.externalIdentity.updateMany({ where: { userId: invalid.userId }, data: { administrativeHoldAt: new Date() } });
    const soloEvent = await event();
    await expect(registerEntrant(invalid.userId, soloEvent, solo(invalid))).rejects.toThrow('COMPETITIVE_IDENTITY_REQUIRED');
    for (const size of [2, 3, 5]) {
      const e = await event(2, `${size}v${size}`), players = await Promise.all(Array.from({ length: size + 2 }, () => player()));
      const teamId = await team(players);
      const roster = players.map((p, i) => ({ playerId: p.id, isStarter: i < size }));
      await expect(registerEntrant(players[0].userId, e, { teamId, roster })).rejects.toThrow(size === 5 ? 'INVALID_INPUT' : 'SUBSTITUTE_LIMIT_EXCEEDED');
      const entry = await registerEntrant(players[0].userId, e, { teamId, roster: roster.slice(0, size) });
      await editRoster(players[0].userId, e, entry.id, { roster: roster.slice(0, size + 1) });
      await editRoster(players[0].userId, e, entry.id, { roster: roster.slice(0, size) });
      expect(await db.tournamentRosterMember.count({ where: { registrationId: entry.id } })).toBe(size);
    }
  });
  it('requires self-check-in and makes concurrent duplicate check-ins idempotent', async () => {
    const e = await event(), p = await player();
    await registerEntrant(p.userId, e, solo(p));
    await expect(checkInPlayer(p.userId, e)).rejects.toThrow('CHECK_IN_WINDOW_CLOSED');
    await schedule(e, 60000);
    await expect(checkInPlayer(p.userId, e, { playerId: 'another-player' })).rejects.toThrow('INVALID_INPUT');
    const result = await race(e, () => checkInPlayer(p.userId, e), () => checkInPlayer(p.userId, e));
    expect(result.every(r => r.status === 'fulfilled')).toBe(true);
    expect(await auditCount(e, 'PLAYER_SELF_CHECK_IN_CONFIRMED')).toBe(1);
    const receipt = await db.tournamentRosterMember.findFirstOrThrow({ where: { registration: { tournamentId: e } } });
    await checkInPlayer(p.userId, e);
    expect((await db.tournamentRosterMember.findUniqueOrThrow({ where: { id: receipt.id } })).checkedInAt).toEqual(receipt.checkedInAt);
  });
  it('consumes one Floor 2 incident under concurrent late check-ins and rejects Floor 1 protection', async () => {
    const e = await event(), p = await player(2), other = await player();
    await registerEntrant(p.userId, e, solo(p)); await registerEntrant(other.userId, e, solo(other)); await schedule(e, -60000);
    await expect(recordLatenessClaim(other.userId, e, { reason: 'Synthetic delay' })).rejects.toThrow('FLOOR_2_REQUIRED');
    const requests = await race(e, () => recordLatenessClaim(p.userId, e, { reason: 'Synthetic delay' }), () => recordLatenessClaim(p.userId, e, { reason: 'Synthetic delay' }));
    expect(requests.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const request = (requests.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<{ id: string }>).value;
    const receipts = await race(e, () => checkInPlayer(p.userId, e, { latenessRequestId: request.id }), () => checkInPlayer(p.userId, e, { latenessRequestId: request.id }));
    expect(receipts.every(r => r.status === 'fulfilled')).toBe(true);
    expect(await auditCount(e, 'LATENESS_AUTOMATICALLY_APPROVED_AND_USED')).toBe(1);
    expect(await db.tournamentLatenessClaim.count({ where: { tournamentId: e, usedAt: { not: null } } })).toBe(1);
  });
  it('does not consume protection after expiry', async () => {
    const e = await event(), p = await player(2); await registerEntrant(p.userId, e, solo(p)); await schedule(e, -960000);
    await expect(recordLatenessClaim(p.userId, e, { reason: 'Expired synthetic delay' })).rejects.toThrow('PROTECTED_CHECK_IN_DEADLINE_PASSED');
    expect(await db.tournamentLatenessClaim.count({ where: { tournamentId: e, usedAt: { not: null } } })).toBe(0);
  });
  it('serializes finalization racing with a protected late arrival', async () => {
    const e = await event(), p = await player(2), ref = await player(1, 'REFEREE');
    await registerEntrant(p.userId, e, solo(p)); await schedule(e, -60000);
    const request = await recordLatenessClaim(p.userId, e, { reason: 'Synthetic delay' });
    const results = await race<unknown>(e, () => finalizeTournament(ref.userId, e), () => checkInPlayer(p.userId, e, { latenessRequestId: request.id }));
    expect(results[1].status).toBe('fulfilled');
    if (results[0].status === 'rejected') {
      expect(String(results[0].reason)).toContain('FLOOR_2_PROTECTION_WINDOW_PENDING');
      await finalizeTournament(ref.userId, e); // Explicit domain-pending retry after arrival, never blind retry.
    }
    expect((await db.tournamentLockSnapshot.findUniqueOrThrow({ where: { tournamentId: e } })).activePlayerCount).toBe(1);
  });
  for (const count of [63, 64]) it(`locks exactly ${count} eligible starters and derives classification automatically`, async () => {
    const e = await event(64), refs = await Promise.all([player(1, 'REFEREE'), player(1, 'REFEREE')]);
    const players = await bulkPlayers(count);
    await schedule(e, -60000); await seedStarters(e, players, true);
    const finals = await race(e, () => finalizeTournament(refs[0].userId, e), () => finalizeTournament(refs[1].userId, e));
    expect(finals.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(String((finals.find(r => r.status === 'rejected') as PromiseRejectedResult).reason)).toContain('TOURNAMENT_ROSTER_LOCKED');
    const snapshot = await db.tournamentLockSnapshot.findUniqueOrThrow({ where: { tournamentId: e } });
    expect(snapshot.activePlayerCount).toBe(count); expect(snapshot.classification).toBe(count === 64 ? 'GRAND_BATTLE' : 'ORDINARY');
    expect(await auditCount(e, 'ROSTERS_SETTINGS_AND_CLASSIFICATION_LOCKED')).toBe(1);
    await expect(db.tournamentLockSnapshot.update({ where: { tournamentId: e }, data: { digest: 'tamper' } })).rejects.toThrow('LOCK_SNAPSHOT_IMMUTABLE');
    await expect(db.tournamentLockSnapshot.delete({ where: { tournamentId: e } })).rejects.toThrow('LOCK_SNAPSHOT_IMMUTABLE');
    const entry = await db.tournamentRegistration.findFirstOrThrow({ where: { tournamentId: e, soloPlayerId: players[0].id } });
    await withdrawEntrant(players[0].userId, e, entry.id);
    expect((await db.tournamentLockSnapshot.findUniqueOrThrow({ where: { tournamentId: e } })).digest).toBe(snapshot.digest);
    await expect(editRoster(players[0].userId, e, entry.id, solo(players[0]))).rejects.toThrow('TOURNAMENT_ROSTER_LOCKED');
  });
  it('produces a real SERIALIZABLE conflict and retries only the aborted transaction', async () => {
    const e = await event(), gate = barrier(), pids: number[] = [];
    const result = await Promise.allSettled(clients.slice(1).map(client => transaction(client, async tx => {
      pids.push((await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid);
      await tx.tournament.findUniqueOrThrow({ where: { id: e } }); await gate();
      await tx.tournament.update({ where: { id: e }, data: { name: `${run}_serializable` } });
    }, 'Serializable')));
    expect(new Set(pids).size).toBe(2); expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const failed = result.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason.code).toBe('P2034');
    await transaction(db, tx => tx.tournament.update({ where: { id: e }, data: { name: `${run}_serializable` } }), 'Serializable');
    expect((await db.tournament.findUniqueOrThrow({ where: { id: e } })).name).toBe(`${run}_serializable`);
  });
  it('enforces capacity for direct writes and rejects fabricated snapshot counts', async () => {
    const e = await event(), players = await Promise.all([player(), player(), player()]);
    await seedStarters(e, players.slice(0, 2));
    await expect(db.tournamentRegistration.create({ data: { tournamentId: e, soloPlayerId: players[2].id, status: 'APPROVED' } })).rejects.toThrow('TOURNAMENT_CAPACITY_REACHED');
    expect(await db.tournamentRegistration.count({ where: { tournamentId: e } })).toBe(2);
    const f = await event(), p = await player(), ref = await player(1, 'REFEREE');
    await schedule(f, -60000); await seedStarters(f, [p], true);
    const lockedAt = await time();
    await db.tournamentRegistration.updateMany({ where: { tournamentId: f }, data: { rosterLockedAt: lockedAt } });
    await db.tournament.update({ where: { id: f }, data: { status: 'ROSTER_LOCKED' } });
    await expect(db.tournamentLockSnapshot.create({ data: { tournamentId: f, lockedAt, lockedById: ref.userId, rulesVersion: attendanceRuleVersion,
      activePlayerCount: 64, classification: 'GRAND_BATTLE', snapshot: { entrants: [] }, digest: 'synthetic-invalid' } })).rejects.toThrow('SNAPSHOT_PARTICIPANT_COUNT_MISMATCH');
    expect(await db.tournamentLockSnapshot.count({ where: { tournamentId: f } })).toBe(0);
  });
  it('excludes optional bench players and rejects a participating referee', async () => {
    const e = await event(2, '2v2'), ref = await player(1, 'REFEREE');
    let captain!: Player;
    for (let i = 0; i < 2; i++) {
      const members = await Promise.all([player(), player(), player()]); captain = members[0];
      const teamId = await team(members);
      await registerEntrant(captain.userId, e, { teamId, roster: members.map((p, index) => ({ playerId: p.id, isStarter: index < 2 })) });
    }
    await schedule(e, -60000);
    const eventRow = await db.tournament.findUniqueOrThrow({ where: { id: e } });
    await db.tournamentRosterMember.updateMany({ where: { registration: { tournamentId: e } }, data: { checkedInAt: new Date(eventRow.startsAt!.getTime() - 60000), checkInRuleVersion: attendanceRuleVersion } });
    await db.user.update({ where: { id: captain.userId }, data: { role: 'REFEREE' } });
    await expect(finalizeTournament(captain.userId, e)).rejects.toThrow('CONFLICT_OF_INTEREST');
    const snapshot = await finalizeTournament(ref.userId, e);
    expect(snapshot.activePlayerCount).toBe(4);
    expect(snapshot.classification).toBe('ORDINARY');
  });

  it('rejects late registration racing with roster locking without changing the frozen field', async () => {
    const e = await event(), p = await player(), late = await player(), ref = await player(1, 'REFEREE');
    await schedule(e, -60000); await seedStarters(e, [p], true);
    const results = await race<unknown>(e, () => finalizeTournament(ref.userId, e), () => registerEntrant(late.userId, e, solo(late)));
    expect(results[0].status).toBe('fulfilled'); expect(results[1].status).toBe('rejected');
    const code = String((results[1] as PromiseRejectedResult).reason);
    expect(code.includes('REGISTRATION_CLOSED') || code.includes('TOURNAMENT_ROSTER_LOCKED')).toBe(true);
    expect(await db.tournamentRegistration.count({ where: { tournamentId: e } })).toBe(1);
    expect((await db.tournamentLockSnapshot.findUniqueOrThrow({ where: { tournamentId: e } })).activePlayerCount).toBe(1);
    expect(await auditCount(e, 'ENTRANT_REGISTERED')).toBe(0);
  });

});
