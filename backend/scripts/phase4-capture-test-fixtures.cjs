'use strict';
// Synthetic test evidence ONLY: signatures here do not attest any database work.
const { randomUUID } = require('node:crypto');
const { digest, sign } = require('./phase4-reusable/common.cjs');
function syntheticReceipt(c, receipt, intent, captureKey = c.trust.capture.privateKey) {
  const i = c.policy.captureInstallation;
  c.xids ??= new Map();
  if (!c.xids.has(receipt.transactionId)) c.xids.set(receipt.transactionId, String(c.xids.size + 100));
  const xid = c.xids.get(receipt.transactionId);
  const evidence = {
    version: 1, kind: 'phase4-database-evidence', installationDigest: digest(i), identity: c.snapshot.identity,
    ...receipt, intentDigest: digest(intent), epoch: i.epoch, leaseId: c.leaseId,
    xid, sourceDigest: c.policy.sourceDigest, catalogDigest: c.policy.catalogDigest, ledgerDigest: c.policy.ledgerDigest,
    observation: { observedAt: new Date(c.now).toISOString(), independentSession: true, observerSession: c.observerId, evidenceDigest: digest('synthetic-test-evidence'),
      kind: receipt.outcome === 'COMMITTED' ? 'committed-outbox' : receipt.outcome === 'ROLLED_BACK' ? 'server-terminal-abort' : 'uncertain',
      terminal: receipt.outcome !== 'UNKNOWN', markerId: randomUUID(), complete: true, operationDigest: digest(receipt.operations) },
    mutationProof: { protocol: 'shared-gate-v1', targetDigest: receipt.targetDigest, epoch: i.epoch,
      fence: receipt.leaseFence, leaseId: c.leaseId, transactionId: receipt.transactionId, xid, session: receipt.session,
      databaseTime: c.now, validUntil: c.now + 60000, gateHeldThroughCommit: true, sameTransactionCapture: true, privilegeBypassExcluded: true, mutationCount: receipt.operations.length },
  };
  return sign({ ...receipt, capture: 'transactional-v2', databaseEvidence: sign(evidence, c.trust.database.privateKey) }, captureKey);
}
function syntheticSeal(c, header, receipts) {
  return sign({ version: 1, kind: 'phase4-capture-seal', installationDigest: digest(c.policy.captureInstallation), epoch: c.policy.captureInstallation.epoch,
    runId: header.runId, targetDigest: header.targetDigest, leaseFence: header.leaseFence, snapshotDigest: digest(c.snapshot),
    transactions: receipts.map(r => ({ transactionId: r.transactionId, evidenceDigest: digest(r.databaseEvidence) })).sort((a, b) => a.transactionId.localeCompare(b.transactionId)),
    admissionClosed: true, allSessionsSettled: true, unresolvedTransactions: 0, exclusiveGateHeld: true }, c.trust.database.privateKey);
}
module.exports = { syntheticReceipt, syntheticSeal };
