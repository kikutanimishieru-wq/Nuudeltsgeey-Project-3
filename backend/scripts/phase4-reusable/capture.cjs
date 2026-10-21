'use strict';
const { requireSafe: check, digest, canonical, hash, sign, verify } = require('./common.cjs');
const { validateTarget } = require('./policy.cjs');
const { UUID, verifyMutationProof } = require('./fencing.cjs');
const { validateKey } = require('./inventory.cjs');
function installationFor(policy) {
  const i = policy.captureInstallation;
  check(i?.version === 1 && UUID.test(i.epoch) && i.mode === 'transactional-outbox-v1' && hash(i.observerDigest) && hash(i.gateDigest) && i.allMutationPathsCovered === true, 'CAPTURE_INSTALLATION_UNVERIFIED');
  return i;
}
function verifyDatabaseEvidence(envelope, policy, binding, now = Date.now()) {
  const installation = installationFor(policy);
  const e = verify(envelope, policy.keys.database);
  check(e.version === 1 && e.kind === 'phase4-database-evidence' && e.installationDigest === digest(installation), 'DATABASE_EVIDENCE_PROTOCOL');
  // Verify immutable historical evidence at its independently attested observation
  // time. Current target/freshness is checked separately by the inventory path.
  const observedAt = Date.parse(e.observation?.observedAt);
  check(Number.isFinite(observedAt) && observedAt <= now, 'DATABASE_EVIDENCE_TIME');
  validateTarget(e.identity, policy, observedAt);
  check(Date.parse(policy.target.expiresAt) - now >= 600000, 'TARGET_EXPIRED');
  for (const field of ['runId', 'transactionId', 'caseId', 'targetDigest', 'leaseFence', 'intentDigest']) check(e[field] === binding[field], 'DATABASE_EVIDENCE_BINDING');
  check(/^p4_[a-f0-9]{32}$/.test(e.runId) && UUID.test(e.transactionId) && Object.hasOwn(require('../phase4-case-names.json'), e.caseId) && Number.isSafeInteger(e.leaseFence) && e.leaseFence > 0, 'DATABASE_EVIDENCE_SCOPE');
  check(e.targetDigest === digest(policy.target) && e.sourceDigest === policy.sourceDigest && e.catalogDigest === policy.catalogDigest && e.ledgerDigest === policy.ledgerDigest, 'DATABASE_EVIDENCE_INSTALLATION');
  check(UUID.test(e.leaseId) && /^[1-9][0-9]{0,19}$/.test(e.xid) && BigInt(e.xid) <= 18446744073709551615n && e.epoch === installation.epoch && hash(e.intentDigest), 'DATABASE_TRANSACTION_IDENTITY');
  check(e.session && Number.isSafeInteger(e.session.pid) && e.session.pid > 0 && Number.isFinite(Date.parse(e.session.backendStart)) && UUID.test(e.session.id), 'DATABASE_SESSION_IDENTITY');
  check(['COMMITTED', 'ROLLED_BACK', 'UNKNOWN'].includes(e.outcome) && Array.isArray(e.operations), 'DATABASE_OUTCOME');
  check(e.observation && e.observation.independentSession === true && UUID.test(e.observation.observerSession) && e.observation.observerSession !== e.session.id, 'INDEPENDENT_OBSERVER_REQUIRED');
  check(hash(e.observation.evidenceDigest), 'DATABASE_EVIDENCE_MISSING');
  if (e.outcome === 'COMMITTED') {
    check(e.observation.kind === 'committed-outbox' && e.observation.terminal === true && UUID.test(e.observation.markerId) && e.observation.complete === true, 'COMMIT_NOT_VERIFIED');
    check(e.operations.length > 0, 'CAPTURE_EMPTY_COMMIT');
    check(e.observation.operationDigest === digest(e.operations), 'CAPTURE_INCOMPLETE');
    verifyMutationProof(e.mutationProof, e, installation);
    check(e.mutationProof.databaseTime <= observedAt, 'DATABASE_EVIDENCE_TIME');
    check(Date.parse(e.session.backendStart) <= e.mutationProof.databaseTime, 'DATABASE_SESSION_IDENTITY');
  } else {
    check(e.operations.length === 0, 'UNCOMMITTED_OPERATIONS');
    check(e.outcome === 'UNKNOWN' ? e.observation.kind === 'uncertain' && e.observation.terminal === false : e.observation.kind === 'server-terminal-abort' && e.observation.terminal === true, 'ABORT_NOT_VERIFIED');
  }
  for (const op of e.operations) {
    validateKey(op.table, op.key);
    check(UUID.test(op.fixtureId) && ['insert', 'update', 'delete'].includes(op.operation) && hash(op.digest) && Array.isArray(op.relationships), 'CAPTURE_OPERATION');
  }
  return e;
}
function issueCapture(databaseEvidence, policy, binding, privateKey, now = Date.now()) {
  const e = verifyDatabaseEvidence(databaseEvidence, policy, binding, now);
  const receipt = { capture: 'transactional-v2', runId: e.runId, transactionId: e.transactionId, caseId: e.caseId,
    targetDigest: e.targetDigest, leaseFence: e.leaseFence, outcome: e.outcome, session: e.session, operations: e.operations,
    databaseEvidence };
  const envelope = sign(receipt, privateKey);
  verify(envelope, policy.keys.capture); // A worker/observer key cannot substitute for the capture key.
  return envelope;
}
function verifyCapture(envelope, policy, binding, now = Date.now()) {
  const receipt = verify(envelope, policy.keys.capture);
  check(receipt.capture === 'transactional-v2', 'LEGACY_CAPTURE_UNVERIFIABLE');
  const e = verifyDatabaseEvidence(receipt.databaseEvidence, policy, binding, now);
  for (const field of ['runId', 'transactionId', 'caseId', 'targetDigest', 'leaseFence', 'outcome', 'session', 'operations']) check(canonical(receipt[field]) === canonical(e[field]), 'CAPTURE_EVIDENCE_MISMATCH');
  return receipt;
}
function verifyRunSeal(envelope, policy, binding, receipts, snapshotDigest) {
  const installation = installationFor(policy), seal = verify(envelope, policy.keys.database);
  check(seal.version === 1 && seal.kind === 'phase4-capture-seal' && seal.installationDigest === digest(installation) && seal.epoch === installation.epoch, 'CAPTURE_SEAL_PROTOCOL');
  for (const f of ['runId', 'targetDigest', 'leaseFence']) check(seal[f] === binding[f], 'CAPTURE_SEAL_BINDING');
  const transactions = receipts.map(r => ({ transactionId: r.transactionId, evidenceDigest: digest(r.databaseEvidence) })).sort((a, b) => a.transactionId.localeCompare(b.transactionId));
  check(seal.snapshotDigest === snapshotDigest && canonical(seal.transactions) === canonical(transactions), 'CAPTURE_SEAL_INCOMPLETE');
  check(seal.admissionClosed === true && seal.allSessionsSettled === true && seal.unresolvedTransactions === 0 && seal.exclusiveGateHeld === true, 'CAPTURE_SEAL_UNSETTLED');
}
module.exports = { installationFor, verifyDatabaseEvidence, issueCapture, verifyCapture, verifyRunSeal };
