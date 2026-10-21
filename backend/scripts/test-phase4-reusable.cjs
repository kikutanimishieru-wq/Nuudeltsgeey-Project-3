'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateKeyPairSync, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { canonical, digest, sign } = require('./phase4-reusable/common.cjs');
const { validateTarget, PINS, sourceDigest } = require('./phase4-reusable/policy.cjs');
const { TABLES, rowRecord, collectReadOnly, SNAPSHOT_SQL } = require('./phase4-reusable/inventory.cjs');
const { ManifestWriter, loadJournal, runId, writeExclusive } = require('./phase4-reusable/manifest.cjs');
const { analyze, verifyClean } = require('./phase4-reusable/dry-run.cjs');
const { executeCleanup } = require('./phase4-reusable/executor.cjs');
const { syntheticReceipt, syntheticSeal } = require('./phase4-capture-test-fixtures.cjs');
function keys() { return generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }); }
const trust = { manifest: keys(), capture: keys(), inventory: keys(), database: keys() };
const now = Date.parse('2026-10-19T12:00:00Z');
function context(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phase4-reusable-local-')));
  fs.chmodSync(directory, 0o700); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = { project: 'rough-snow-56584532', branch: 'br-local-approved', endpoint: 'ep-local-approved', hostname: 'ep-local-approved.c-7.us-east-2.aws.neon.tech', database: 'phase4_native_local', databaseOid: 1234, role: 'phase4_worker', expiresAt: '2026-10-26T09:48:09Z' };
  const snapshot = { version: 1, kind: 'phase4-inventory', identity: { ...target, branchProject: target.project, endpointBranch: target.branch, ready: true, primary: false, default: false, protected: false, initSource: 'parent-schema', productionBranches: ['br-production'], productionEndpoints: ['ep-production'], tlsVerified: true, direct: true, workerRestricted: true, schema: 'public', observedAt: new Date(now).toISOString() },
    catalog: { columns: [], constraints: [], indexes: [], enums: [], functions: [], triggers: [], security: {} },
    objects: { relations: [], sequences: [], dependencies: [], eventTriggers: [], extensions: [] }, sequenceState: [],
    ledger: Object.entries(PINS).map(([migration_name, checksum]) => ({ migration_name, checksum, finished_at: 'complete', rolled_back_at: null })),
    tables: TABLES, rows: Object.fromEntries(TABLES.map(n => [n, []])),
    quiescence: { activeSessions: 0, preparedTransactions: 0, unresolvedOperations: 0 }, lease: { fence: 1, admissionClosed: true, validUntil: new Date(now + 300000).toISOString() } };
  const policy = { version: 1, enabled: true, target, keys: Object.fromEntries(Object.entries(trust).map(([name, k]) => [name, k.publicKey])), catalogDigest: digest({ catalog: snapshot.catalog, objects: snapshot.objects }), ledgerDigest: digest(snapshot.ledger), sourceDigest: sourceDigest(), captureInstallation: { version: 1, epoch: randomUUID(), mode: 'transactional-outbox-v1', observerDigest: digest('synthetic-observer'), gateDigest: digest('synthetic-gate'), allMutationPathsCovered: true } };
  return { directory, snapshot, policy, trust, now, leaseId: randomUUID(), observerId: randomUUID() };
}
function journal(c, operations = [], options = {}) {
  const directory = path.join(c.directory, randomUUID()); fs.mkdirSync(directory, { mode: 0o700 });
  const writer = new ManifestWriter(directory, trust.manifest.privateKey, trust.manifest.publicKey);
  const run = runId(), transactionId = randomUUID();
  const header = { type: 'run', version: 1, runId: run, targetDigest: digest(c.policy.target), sourceDigest: c.policy.sourceDigest, catalogDigest: c.policy.catalogDigest, ledgerDigest: c.policy.ledgerDigest, authorizationDigest: digest('local-test-approval'), leaseFence: 1 };
  writer.append(header);
  const receipts = [];
  if (operations.length || options.intent) {
    const intent = { type: 'intent', transactionId, caseId: 'P4-N01', tables: [...new Set(operations.map(o => o.table).concat(options.tables ?? ['User']))], fixtures: operations.map(o => ({ table: o.table, key: o.key })) };
    writer.append(intent);
    if (!options.missingReceipt) {
      const envelope = syntheticReceipt(c, { capture: 'transactional-v2', runId: run, transactionId, caseId: 'P4-N01', targetDigest: digest(c.policy.target), leaseFence: 1, outcome: options.outcome ?? 'COMMITTED', session: { pid: 23, backendStart: '2026-10-19T11:50:00Z', id: randomUUID() }, operations }, intent, options.captureKey ?? trust.capture.privateKey);
      receipts.push(envelope.payload); writer.append({ type: 'receipt', envelope });
    }
  }
  if (!options.missingEnd) writer.append({ type: 'end', state: options.state ?? 'PASSED', snapshotDigest: digest(c.snapshot), captureSeal: syntheticSeal(c, header, receipts) });
  writer.close();
  return directory;
}
const insertion = (table, row) => ({ ...rowRecord(table, row), fixtureId: randomUUID(), operation: 'insert' });
const invoke = (c, dirs = []) => analyze({ inventory: sign(c.snapshot, trust.inventory.privateKey), manifestDirectories: dirs, policy: c.policy, now });

test('exact target checks branch endpoint hostname database OID role expiry and freshness', t => {
  const c = context(t); assert.equal(validateTarget(c.snapshot.identity, c.policy, now), digest(c.policy.target));
  for (const field of ['project', 'branch', 'endpoint', 'hostname', 'database', 'databaseOid', 'role', 'expiresAt']) assert.throws(() => validateTarget({ ...c.snapshot.identity, [field]: 'wrong' }, c.policy, now));
  for (const patch of [{ observedAt: '2020-01-01Z' }, { endpointBranch: 'wrong' }, { tlsVerified: false }, { default: true }, { workerRestricted: false }, { productionEndpoints: [] }, { productionBranches: [c.policy.target.branch] }]) assert.throws(() => validateTarget({ ...c.snapshot.identity, ...patch }, c.policy, now));
  assert.throws(() => validateTarget(c.snapshot.identity, c.policy, Date.parse(c.policy.target.expiresAt)), /EXPIRED/);
});
test('production V2 V3 V4 and disabled policy cannot be selected or overridden', t => {
  const c = context(t);
  for (const branch of ['br-wispy-mountain-b5nku4bf', 'br-plain-glitter-b5cadax8', 'br-morning-queen-b5u7j4qz', 'br-withered-mode-b528hnhk']) assert.throws(() => validateTarget(c.snapshot.identity, { ...c.policy, target: { ...c.policy.target, branch } }, now), /HISTORICAL/);
  for (const endpoint of ['ep-crimson-rain-b5po4mqa', 'ep-wispy-voice-b4nvm1b4', 'ep-delicate-poetry-b5bbwllj']) assert.throws(() => validateTarget(c.snapshot.identity, { ...c.policy, target: { ...c.policy.target, endpoint } }, now), /HISTORICAL/);
  assert.throws(() => validateTarget(c.snapshot.identity), /NOT_APPROVED/);
});
test('durable signed journal round-trips and rejects modification gaps signatures and symlinks', t => {
  const c = context(t), dir = journal(c);
  assert.equal(loadJournal(dir, trust.manifest.publicKey).length, 2);
  const first = path.join(dir, '00000000.json'), data = JSON.parse(fs.readFileSync(first)); data.payload.event.runId = runId(); fs.writeFileSync(first, JSON.stringify(data));
  assert.throws(() => loadJournal(dir, trust.manifest.publicKey), /SIGNATURE/);
  const dir2 = journal(c); fs.renameSync(path.join(dir2, '00000001.json'), path.join(dir2, '00000002.json'));
  assert.throws(() => loadJournal(dir2, trust.manifest.publicKey), /GAP/);
  const link = path.join(c.directory, 'link'); fs.symlinkSync(dir, link); assert.throws(() => loadJournal(link, trust.manifest.publicKey));
});
test('exclusive writer and private modes prevent accidental overwrite and concurrent writers', t => {
  const c = context(t), writer = new ManifestWriter(c.directory, trust.manifest.privateKey, trust.manifest.publicKey);
  assert.throws(() => new ManifestWriter(c.directory, trust.manifest.privateKey, trust.manifest.publicKey)); writer.close();
  fs.chmodSync(c.directory, 0o755); assert.throws(() => new ManifestWriter(c.directory, trust.manifest.privateKey, trust.manifest.publicKey), /PRIVATE/);
});
test('captured fixture ID table key content and dependencies establish ownership without names', t => {
  const c = context(t); c.snapshot.rows.User.push({ id: 'ordinary-opaque-key', email: 'fixture@example.invalid' });
  const report = invoke(c, [journal(c, [insertion('User', c.snapshot.rows.User[0])])]);
  assert.equal(report.tables.length, 37); assert.equal(report.tables.find(t => t.table === 'User').owned, 1);
  assert.equal(report.tables.find(t => t.table === 'User').proposed[0].key.id, 'ordinary-opaque-key');
  assert.deepEqual(report.blockers, ['EXECUTOR_DISABLED']); assert.equal(report.approvedDeletionCount, 0);
});
test('missing manifests leave plausible prefixed records unknown', t => {
  const c = context(t); c.snapshot.rows.User.push({ id: 'p4_' + 'a'.repeat(16) + '_' + randomUUID(), email: 'synthetic@example.invalid' });
  const report = invoke(c); assert(report.blockers.includes('MANIFEST_MISSING')); assert(report.blockers.includes('UNKNOWN_RECORDS'));
  assert.equal(report.tables.find(t => t.table === 'User').unknown, 1);
});
test('worker-signed or tampered capture receipts cannot manufacture ownership', t => {
  const c = context(t); c.snapshot.rows.User.push({ id: 'fixture' });
  const report = invoke(c, [journal(c, [insertion('User', c.snapshot.rows.User[0])], { captureKey: trust.manifest.privateKey })]);
  assert(report.blockers.includes('SIGNATURE')); assert.equal(report.tables.find(t => t.table === 'User').owned, 0);
});
test('changed row content or ownership relationships remain unknown', t => {
  const c = context(t); c.snapshot.rows.User.push({ id: 'fixture', email: 'changed' });
  const operation = insertion('User', { id: 'fixture', email: 'before' });
  const report = invoke(c, [journal(c, [operation])]); assert(report.blockers.includes('UNKNOWN_RECORDS'));
});
test('interrupted or unresolved independently committed work cannot be assumed rolled back', t => {
  for (const options of [{ intent: true, missingReceipt: true }, { intent: true, outcome: 'UNKNOWN' }, { missingEnd: true }]) {
    const c = context(t); const report = invoke(c, [journal(c, [], options)]);
    assert(report.blockers.includes('UNSETTLED_TRANSACTIONS'));
  }
  const c = context(t); c.snapshot.quiescence.activeSessions = 1;
  assert(invoke(c).blockers.includes('SESSIONS_UNSETTLED'));
});
test('a failed run with settled commits is inspectable; rollback receipts own no rows', t => {
  const c = context(t); c.snapshot.rows.User.push({ id: 'committed-before-failure' });
  const report = invoke(c, [journal(c, [insertion('User', c.snapshot.rows.User[0])], { state: 'FAILED' })]);
  assert.equal(report.tables.find(t => t.table === 'User').owned, 1);
  const d = context(t); const rolled = invoke(d, [journal(d, [], { intent: true, outcome: 'ROLLED_BACK', state: 'FAILED' })]);
  assert.deepEqual(rolled.blockers, ['EXECUTOR_DISABLED']);
});
test('one rollback does not erase another session commit from inventory', t => {
  const c = context(t); c.snapshot.rows.User.push({ id: 'other-session-commit' });
  const report = invoke(c, [journal(c, [], { intent: true, outcome: 'ROLLED_BACK' })]);
  assert.equal(report.tables.find(t => t.table === 'User').unknown, 1); assert(report.blockers.includes('UNKNOWN_RECORDS'));
});
test('FK and non-FK relationships expose shared unknown references', t => {
  const c = context(t); c.snapshot.rows.User.push({ id: 'shared' });
  const profile = { id: 'profile', userId: 'shared', currentTeamId: null, homeCafeId: null }; c.snapshot.rows.PlayerProfile.push(profile);
  const report = invoke(c, [journal(c, [insertion('PlayerProfile', profile)])]);
  assert(report.blockers.includes('SHARED_DEPENDENCY')); assert.equal(report.dependencies.length, 1);
  assert.equal(report.dependencies[0].resolved, true);
});
test('missing children and unknown JSON references are blockers, not deletion guesses', t => {
  const c = context(t); c.snapshot.rows.TournamentLockSnapshot.push({ tournamentId: 'missing', lockedById: 'missing', snapshot: { alienId: 'unknown' } });
  const report = invoke(c); assert(report.blockers.includes('UNKNOWN_JSON_REFERENCE')); assert(report.blockers.includes('UNKNOWN_RECORDS'));
});
test('immutable history and locked fixtures never cause trigger changes or cleanup execution', t => {
  const c = context(t); c.snapshot.rows.TournamentLockSnapshot.push({ tournamentId: 'missing', lockedById: 'missing', snapshot: {} });
  const report = invoke(c); assert(report.blockers.includes('IMMUTABLE_HISTORY')); assert(report.blockers.includes('DEPENDENCY_UNRESOLVED'));
  let called = false; assert.throws(() => executeCleanup(() => { called = true; }), /DISABLED/); assert.equal(called, false);
});
test('schema migration source drift and extra tables fail before ownership classification', t => {
  for (const mutate of [s => s.ledger.pop(), s => s.catalog.triggers.push('disabled'), s => { s.tables = [...s.tables, 'Unknown']; }, s => s.objects.eventTriggers.push('new')]) {
    const c = context(t); mutate(c.snapshot); const report = invoke(c); assert.equal(report.tables.length, 0); assert(report.blockers.length > 1);
  }
});
test('signed inventory cannot be substituted forged or replayed after freshness window', t => {
  const c = context(t);
  const forged = analyze({ inventory: sign(c.snapshot, trust.manifest.privateKey), policy: c.policy, now }); assert(forged.blockers.includes('SIGNATURE'));
  const stale = analyze({ inventory: sign(c.snapshot, trust.inventory.privateKey), policy: c.policy, now: now + 61000 }); assert(stale.blockers.includes('IDENTITY_STALE'));
});
test('composite keys and default UUID children have explicit ownership records', t => {
  const c = context(t), row = { incidentId: 'incident', userId: 'user' };
  const op = insertion('IncidentParty', row); assert.deepEqual(op.key, row); assert.equal(op.relationships.length, 2);
  const bad = { ...op, key: { incidentId: 'incident' } };
  assert(invoke(c, [journal(c, [bad])]).blockers.includes('KEY_INCOMPLETE'));
});
test('manifest/snapshot binding and active writer lock fail closed', t => {
  const c = context(t), dir = journal(c); c.snapshot.rows.User.push({ id: 'added-after-seal' });
  assert(invoke(c, [dir]).blockers.includes('MANIFEST_INCOMPLETE'));
  writeExclusive(path.join(dir, '.writer-lock'), { pid: 1 }); assert(invoke(c, [dir]).blockers.includes('MANIFEST_WRITER_ACTIVE'));
});
test('read-only collector calls only one fixed SELECT with no retry or mutation callback', async () => {
  const calls = []; assert.deepEqual(await collectReadOnly(async sql => { calls.push(sql); return [{ snapshot: { readOnly: true } }]; }), { readOnly: true });
  assert.deepEqual(calls, [SNAPSHOT_SQL]); assert.match(SNAPSHOT_SQL, /^SELECT /); assert(!SNAPSHOT_SQL.includes(';'));
  let attempts = 0; await assert.rejects(collectReadOnly(async () => { attempts++; throw Error('local-test-error'); })); assert.equal(attempts, 1);
});
test('fixed inventory SELECT executes in disposable local PostgreSQL memory without migrations', { skip: process.env.PHASE4_NO_DATABASE_TESTS === '1' || process.env.PHASE4_ALLOW_LOCAL_SQL_TESTS !== '1' }, async () => {
  const { PGlite } = require('@electric-sql/pglite'); const db = new PGlite();
  try {
    for (const table of TABLES) await db.exec(`CREATE TABLE "${table}" (id text)`);
    await db.exec('CREATE TABLE "_prisma_migrations" (migration_name text)');
    const before = await db.query('SELECT count(*)::int AS n FROM pg_class');
    const snapshot = await collectReadOnly(async sql => (await db.query(sql)).rows);
    assert.equal(snapshot.tables.length, 37); assert.equal(Object.keys(snapshot.rows).length, 37);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM pg_class')).rows[0].n, before.rows[0].n);
    assert(TABLES.every(t => snapshot.rows[t].length === 0));
  } finally { await db.close(); }
});
test('post-clean comparison requires all tables empty and every preservation component unchanged', t => {
  const c = context(t), before = c.snapshot, after = structuredClone(before);
  assert.equal(verifyClean(before, after), true);
  for (const f of ['ledger', 'catalog', 'objects', 'sequenceState']) {
    const changed = structuredClone(after); changed[f] = ['changed']; assert.throws(() => verifyClean(before, changed), /PRESERVATION/);
  }
  after.rows.Cafe.push({ id: 'unknown' }); assert.throws(() => verifyClean(before, after), /REMAINS/);
});
test('offline CLI rejects mutation flags and URLs and writes only a private BLOCKED artifact', t => {
  const c = context(t), input = path.join(c.directory, 'inventory.json'), output = path.join(c.directory, 'report.json');
  writeExclusive(input, sign(c.snapshot, trust.inventory.privateKey));
  const cli = path.join(__dirname, 'phase4-reusable/cli.cjs');
  const result = spawnSync(process.execPath, [cli, 'dry-run', input, output], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 2); assert.deepEqual(JSON.parse(result.stdout).blockers, ['EXECUTOR_DISABLED', 'TARGET_NOT_APPROVED']); assert.equal(fs.statSync(output).mode & 0o077, 0);
  assert.equal(JSON.parse(fs.readFileSync(output)).executable, false);
  const reject = spawnSync(process.execPath, [cli, 'execute', 'SECRET_URL'], { encoding: 'utf8' }); assert.equal(reject.status, 2); assert(!reject.stderr.includes('SECRET_URL'));
});

test('two independent captured sessions retain winner ownership after loser rollback', t => {
  const c = context(t); c.snapshot.rows.User.push({ id: 'winner' });
  const operation = insertion('User', c.snapshot.rows.User[0]);
  const directory = path.join(c.directory, 'race'); fs.mkdirSync(directory, { mode: 0o700 });
  const writer = new ManifestWriter(directory, trust.manifest.privateKey, trust.manifest.publicKey);
  const run = runId(), group = randomUUID(), header = { type: 'run', version: 1, runId: run, targetDigest: digest(c.policy.target), sourceDigest: c.policy.sourceDigest, catalogDigest: c.policy.catalogDigest, ledgerDigest: c.policy.ledgerDigest, authorizationDigest: digest('approval'), leaseFence: 1 };
  writer.append(header);
  const receipts = [];
  for (const [i, outcome] of ['COMMITTED', 'ROLLED_BACK'].entries()) {
    const transactionId = randomUUID();
    const intent = { type: 'intent', transactionId, caseId: 'P4-N01', concurrencyGroup: group, tables: ['User'], fixtures: [] }; writer.append(intent);
    const envelope = syntheticReceipt(c, { capture: 'transactional-v2', runId: run, transactionId, caseId: 'P4-N01', targetDigest: header.targetDigest, leaseFence: 1, outcome, session: { pid: 50 + i, backendStart: '2026-10-19T11:50:00Z', id: randomUUID() }, operations: i === 0 ? [operation] : [] }, intent);
    receipts.push(envelope.payload); writer.append({ type: 'receipt', envelope });
  }
  writer.append({ type: 'end', state: 'FAILED', snapshotDigest: digest(c.snapshot), captureSeal: syntheticSeal(c, header, receipts) }); writer.close();
  const report = invoke(c, [directory]); assert.equal(report.tables.find(t => t.table === 'User').owned, 1); assert.deepEqual(report.blockers, ['EXECUTOR_DISABLED']);
  // Re-signing a receipt as though both contenders used the same backend is detected.
  const events = loadJournal(directory, trust.manifest.publicKey);
  const envelope = events[4].envelope; envelope.payload.session.pid = 50; events[4].envelope = syntheticReceipt(c, envelope.payload, events[3]);
  events[5].captureSeal = syntheticSeal(c, header, [events[2].envelope.payload, events[4].envelope.payload]);
  const invalid = path.join(c.directory, 'invalid-race'); fs.mkdirSync(invalid, { mode: 0o700 });
  const other = new ManifestWriter(invalid, trust.manifest.privateKey, trust.manifest.publicKey); events.forEach(e => other.append(e)); other.close();
  assert(invoke(c, [invalid]).blockers.includes('CONCURRENCY_SESSIONS_NOT_DISTINCT'));
});

test('partial journals and missing capture proof fail closed without revealing paths', t => {
  const c = context(t), directory = journal(c);
  fs.writeFileSync(path.join(directory, '00000001.json'), '{');
  const report = invoke(c, [directory]); assert(report.blockers.includes('VALIDATION_FAILED'));
  assert(!canonical(report).includes(c.directory));
  const missing = invoke(c, [path.join(c.directory, 'DO_NOT_PRINT')]); assert(!canonical(missing).includes('DO_NOT_PRINT'));
});

test('changed fixtures require prior captured ownership and matching before digest', t => {
  const c = context(t); c.snapshot.rows.User.push({ id: 'unknown' });
  const op = { ...insertion('User', c.snapshot.rows.User[0]), operation: 'update', beforeDigest: digest('unproven') };
  assert(invoke(c, [journal(c, [op])]).blockers.includes('MUTATION_WITHOUT_OWNERSHIP'));
});

test('duplicated run manifests and cross-run dependencies cannot authorize deletion', t => {
  const c = context(t), directory = journal(c);
  assert(invoke(c, [directory, directory]).blockers.includes('DUPLICATE_RUN'));
  c.snapshot.rows.User.push({ id: 'root' });
  const profile = { id: 'child', userId: 'root', currentTeamId: null, homeCafeId: null }; c.snapshot.rows.PlayerProfile.push(profile);
  const report = invoke(c, [journal(c, [insertion('User', c.snapshot.rows.User[0])]), journal(c, [insertion('PlayerProfile', profile)])]);
  assert(report.blockers.includes('CROSS_RUN_DEPENDENCY'));
});

test('lease fencing and distinct trust key identities are mandatory', t => {
  const c = context(t), directory = journal(c);
  c.snapshot.lease.fence = 2;
  assert(invoke(c, [directory]).blockers.includes('LEASE_FENCE_MISMATCH'));
  assert.throws(() => validateTarget(c.snapshot.identity, { ...c.policy, keys: { ...c.policy.keys, capture: '\n' + c.policy.keys.manifest } }, now), /TRUST_KEYS/);
});
