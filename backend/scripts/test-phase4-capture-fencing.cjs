'use strict';
// All database facts below are synthetic signed objects. No database is opened.
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, randomUUID } = require('node:crypto');
const { digest, sign, verify } = require('./phase4-reusable/common.cjs');
const { sourceDigest } = require('./phase4-reusable/policy.cjs');
const { rowRecord } = require('./phase4-reusable/inventory.cjs');
const { verifyDatabaseEvidence, issueCapture, verifyCapture, verifyRunSeal } = require('./phase4-reusable/capture.cjs');
const { initialLease, tokenOf, transitionLease, assertAuthority, authorizeDatabaseMutation } = require('./phase4-reusable/fencing.cjs');
const { executeCleanup } = require('./phase4-reusable/executor.cjs');
const { syntheticReceipt, syntheticSeal } = require('./phase4-capture-test-fixtures.cjs');
function keys() { return generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }); }
const trust = Object.fromEntries(['manifest', 'capture', 'inventory', 'database'].map(k => [k, keys()]));
const now = Date.parse('2026-10-19T12:00:00Z');
function fixture(outcome = 'COMMITTED') {
  const target = { project: 'rough-snow-56584532', branch: 'br-simulated-test', endpoint: 'ep-simulated-test', hostname: 'ep-simulated-test.c-7.us-east-2.aws.neon.tech', database: 'phase4_simulated', databaseOid: 1234, role: 'phase4_worker', expiresAt: '2026-10-26T09:48:09Z' };
  const identity = { ...target, branchProject: target.project, endpointBranch: target.branch, ready: true, primary: false, default: false, protected: false, initSource: 'parent-schema', productionBranches: ['br-production'], productionEndpoints: ['ep-production'], tlsVerified: true, direct: true, workerRestricted: true, schema: 'public', observedAt: new Date(now).toISOString() };
  const policy = { version: 1, enabled: true, target, keys: Object.fromEntries(Object.entries(trust).map(([name, key]) => [name, key.publicKey])), catalogDigest: digest('catalog'), ledgerDigest: digest('ledger'), sourceDigest: sourceDigest(), captureInstallation: { version: 1, epoch: randomUUID(), mode: 'transactional-outbox-v1', observerDigest: digest('simulated-observer'), gateDigest: digest('simulated-gate'), allMutationPathsCovered: true } };
  const intent = { type: 'intent', transactionId: randomUUID(), caseId: 'P4-N01', tables: ['User'], fixtures: [] };
  const binding = { runId: 'p4_' + randomUUID().replaceAll('-', ''), transactionId: intent.transactionId, caseId: intent.caseId, targetDigest: digest(target), leaseFence: 1, intentDigest: digest(intent) };
  const operations = outcome === 'COMMITTED' ? [{ ...rowRecord('User', { id: randomUUID() }), operation: 'insert', fixtureId: randomUUID() }] : [];
  const c = { trust, policy, snapshot: { identity }, now, leaseId: randomUUID(), observerId: randomUUID() };
  const receipt = syntheticReceipt(c, { ...binding, outcome, operations, session: { pid: 17, backendStart: new Date(now - 1000).toISOString(), id: randomUUID() } }, intent);
  return { c, policy, binding, intent, receipt, evidence: receipt.payload.databaseEvidence };
}
function evidenceChange(f, change, signer = trust.database.privateKey) { const payload = structuredClone(f.evidence.payload); change(payload); return sign(payload, signer); }
function acquire(s, databaseNow = 1000, host = randomUUID()) {
  return transitionLease(s, { type: 'acquire', expectedVersion: s.version, holder: host, leaseId: randomUUID(), runId: 'p4_' + randomUUID().replaceAll('-', ''), ttl: 10000 }, databaseNow);
}

test('trusted capture requires independent database evidence plus capture signature', () => {
  const f = fixture();
  const receipt = issueCapture(f.evidence, f.policy, f.binding, trust.capture.privateKey, now);
  assert.equal(verifyCapture(receipt, f.policy, f.binding, now).outcome, 'COMMITTED');
  assert.equal(verify(receipt, trust.capture.publicKey).capture, 'transactional-v2');
});
test('legacy claimed success and capture-only signed outcomes never establish ownership', () => {
  const f = fixture(); const claimed = sign({ capture: 'transactional-v1', outcome: 'COMMITTED' }, trust.capture.privateKey);
  assert.throws(() => verifyCapture(claimed, f.policy, f.binding, now), /LEGACY/);
  const { databaseEvidence, ...noProof } = f.receipt.payload;
  assert.throws(() => verifyCapture(sign(noProof, trust.capture.privateKey), f.policy, f.binding, now), /SIGNATURE/);
});
test('worker capture and inventory keys cannot forge database observer evidence', () => {
  const f = fixture();
  for (const k of ['manifest', 'capture', 'inventory']) assert.throws(() => issueCapture(sign(f.evidence.payload, trust[k].privateKey), f.policy, f.binding, trust.capture.privateKey, now), /SIGNATURE/);
});
test('missing or tampered source and outer signatures are rejected', () => {
  const f = fixture();
  assert.throws(() => verifyDatabaseEvidence({ payload: f.evidence.payload }, f.policy, f.binding, now), /SIGNATURE/);
  const changed = structuredClone(f.evidence); changed.payload.outcome = 'ROLLED_BACK';
  assert.throws(() => issueCapture(changed, f.policy, f.binding, trust.capture.privateKey, now), /SIGNATURE/);
  const outer = structuredClone(f.receipt); outer.payload.outcome = 'ROLLED_BACK';
  assert.throws(() => verifyCapture(outer, f.policy, f.binding, now), /SIGNATURE/);
});
test('a re-signed claimed outcome cannot override independently signed database evidence', () => {
  const f = fixture();
  const forged = sign({ ...f.receipt.payload, outcome: 'ROLLED_BACK', operations: [] }, trust.capture.privateKey);
  assert.throws(() => verifyCapture(forged, f.policy, f.binding, now), /MISMATCH/);
});
test('client acknowledgement row appearance and absent marker are insufficient commit or abort evidence', () => {
  const f = fixture();
  for (const kind of ['client-success', 'plausible-row-scan', 'marker-absent']) assert.throws(() => verifyDatabaseEvidence(evidenceChange(f, e => { e.observation.kind = kind; }), f.policy, f.binding, now), /COMMIT_NOT_VERIFIED/);
  const abort = fixture('ROLLED_BACK');
  assert.throws(() => verifyDatabaseEvidence(evidenceChange(abort, e => { e.observation.kind = 'marker-absent'; }), abort.policy, abort.binding, now), /ABORT_NOT_VERIFIED/);
});
test('uncertain transactions remain UNKNOWN and own no operations', () => {
  const f = fixture('UNKNOWN'); assert.equal(verifyCapture(f.receipt, f.policy, f.binding, now).outcome, 'UNKNOWN');
  assert.deepEqual(f.receipt.payload.operations, []);
  assert.throws(() => verifyDatabaseEvidence(evidenceChange(f, e => { e.observation.terminal = true; }), f.policy, f.binding, now), /ABORT_NOT_VERIFIED/);
});
test('interrupted incomplete capture never becomes a verified committed receipt', () => {
  const f = fixture();
  for (const change of [e => { e.observation.complete = false; }, e => { e.observation.operationDigest = digest([]); }, e => { e.mutationProof.sameTransactionCapture = false; }, e => { e.mutationProof.mutationCount++; }]) assert.throws(() => verifyDatabaseEvidence(evidenceChange(f, change), f.policy, f.binding, now));
});
test('receipt session fence epoch target and pre-write intent are bound independently', () => {
  const f = fixture();
  for (const change of [e => { e.identity.databaseOid++; }, e => { e.leaseFence++; }, e => { e.epoch = randomUUID(); }, e => { e.intentDigest = digest('forged-intent'); }, e => { e.mutationProof.session = { ...e.mutationProof.session, pid: 999 }; }]) assert.throws(() => verifyDatabaseEvidence(evidenceChange(f, change), f.policy, f.binding, now));
});
test('observer must use an independent session and a reviewed installation', () => {
  const f = fixture();
  assert.throws(() => verifyDatabaseEvidence(evidenceChange(f, e => { e.observation.observerSession = e.session.id; }), f.policy, f.binding, now), /OBSERVER/);
  assert.throws(() => verifyDatabaseEvidence(f.evidence, { ...f.policy, captureInstallation: null }, f.binding, now), /INSTALLATION/);
});
test('historical receipts verify at observation time while future evidence is rejected', () => {
  const f = fixture(); assert.equal(verifyCapture(f.receipt, f.policy, f.binding, now + 3600000).outcome, 'COMMITTED');
  assert.throws(() => verifyCapture(f.receipt, f.policy, f.binding, now - 1), /EVIDENCE_TIME/);
});
test('seal prevents a worker from omitting or substituting a transaction', () => {
  const f = fixture(); const seal = syntheticSeal(f.c, f.binding, [f.receipt.payload]);
  verifyRunSeal(seal, f.policy, f.binding, [f.receipt.payload], digest(f.c.snapshot));
  assert.throws(() => verifyRunSeal(seal, f.policy, f.binding, [], digest(f.c.snapshot)), /INCOMPLETE/);
  const missingSig = { payload: seal.payload }; assert.throws(() => verifyRunSeal(missingSig, f.policy, f.binding, [], digest(f.c.snapshot)), /SIGNATURE/);
});
test('database seal signature cannot be replaced by a worker journal signature', () => {
  const f = fixture(), seal = syntheticSeal(f.c, f.binding, [f.receipt.payload]);
  assert.throws(() => verifyRunSeal(sign(seal.payload, trust.manifest.privateKey), f.policy, f.binding, [f.receipt.payload], digest(f.c.snapshot)), /SIGNATURE/);
});
test('partially committed simulated independent sessions retain separate outcomes', () => {
  const winner = fixture('COMMITTED'), loser = fixture('ROLLED_BACK');
  assert.equal(verifyCapture(winner.receipt, winner.policy, winner.binding, now).operations.length, 1);
  assert.equal(verifyCapture(loser.receipt, loser.policy, loser.binding, now).operations.length, 0);
  assert.equal(verifyCapture(winner.receipt, winner.policy, winner.binding, now).outcome, 'COMMITTED');
});
test('reference model compare-and-swap rejects a simultaneous second runner', async () => {
  let state = initialLease(digest('target'), randomUUID()); const readByBoth = structuredClone(state);
  const results = await Promise.allSettled([randomUUID(), randomUUID()].map(async host => {
    const next = acquire(readByBoth, 1000, host);
    assert.equal(state.version, readByBoth.version, 'simulated atomic CAS conflict'); state = next; return state;
  }));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(state.fence, 1);
});
test('reference model stale token is rejected before every simulated mutation', () => {
  const s = acquire(initialLease(digest('target'), randomUUID())), token = tokenOf(s);
  assertAuthority(s, token, 1001);
  for (const patch of [{ fence: 0 }, { epoch: randomUUID() }, { holder: randomUUID() }, { leaseId: randomUUID() }, { targetDigest: digest('other') }, { runId: 'other' }]) assert.throws(() => assertAuthority(s, { ...token, ...patch }, 1001), /STALE/);
});
test('reference model expiration rejects delayed mutations and late renewals', () => {
  const s = acquire(initialLease(digest('target'), randomUUID())), token = tokenOf(s);
  assert.throws(() => assertAuthority(s, token, s.validUntil), /EXPIRED/);
  assert.throws(() => transitionLease(s, { type: 'renew', expectedVersion: s.version, token, ttl: 10000 }, s.validUntil), /EXPIRED/);
});
test('expired or crashed holder cannot be replaced merely because a TTL elapsed', () => {
  const s = acquire(initialLease(digest('target'), randomUUID()));
  assert.throws(() => acquire(s, s.validUntil + 1), /BUSY_OR_UNSETTLED/);
  const q = transitionLease(s, { type: 'quarantine', expectedVersion: s.version }, s.validUntil + 1);
  assert.throws(() => acquire(q, s.validUntil + 2), /BUSY_OR_UNSETTLED/);
  assert.throws(() => assertAuthority(q, tokenOf(q), s.validUntil + 2), /ADMISSION_CLOSED/);
});
test('drain closes new admission and unknown terminal outcomes cannot release authority', () => {
  const s = acquire(initialLease(digest('target'), randomUUID())), token = tokenOf(s);
  const d = transitionLease(s, { type: 'drain', expectedVersion: s.version, token }, 1001);
  assert.throws(() => assertAuthority(d, token, 1002), /ADMISSION_CLOSED/);
  assert.throws(() => transitionLease(d, { type: 'release', expectedVersion: d.version, token }, 1002), /REQUIRES_DATABASE_PROOF/);
});
test('reference model detects clock regression and stale CAS renewal', () => {
  const s = acquire(initialLease(digest('target'), randomUUID())), token = tokenOf(s);
  const renewed = transitionLease(s, { type: 'renew', expectedVersion: s.version, token, ttl: 15000 }, 1001);
  assert.throws(() => transitionLease(renewed, { type: 'drain', expectedVersion: s.version, token }, 1002), /CAS_CONFLICT/);
  assert.throws(() => assertAuthority(renewed, token, 1000), /CLOCK_REGRESSION/);
});
test('signed mutation proof must show atomic gate enforcement not just a startup lease check', () => {
  const f = fixture();
  for (const change of [e => { e.mutationProof.gateHeldThroughCommit = false; }, e => { e.mutationProof.privilegeBypassExcluded = false; }, e => { e.mutationProof.databaseTime = e.mutationProof.validUntil; }]) assert.throws(() => verifyDatabaseEvidence(evidenceChange(f, change), f.policy, f.binding, now));
});
test('neither a simulated valid token nor any callback enables database mutation or cleanup', () => {
  const s = acquire(initialLease(digest('target'), randomUUID())); let called = false;
  assert.throws(() => authorizeDatabaseMutation(s, tokenOf(s), () => { called = true; }), /NOT_INSTALLED/);
  assert.throws(() => executeCleanup(s, tokenOf(s), () => { called = true; }), /DISABLED/);
  assert.equal(called, false);
});
