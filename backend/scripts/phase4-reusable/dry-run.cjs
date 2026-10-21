'use strict';
const { requireSafe: check, canonical, digest, verify } = require('./common.cjs');
const { APPROVED_POLICY, validateTarget, validatePreservation } = require('./policy.cjs');
const { TABLES, address, rowRecord } = require('./inventory.cjs');
const { loadJournal, validateManifest } = require('./manifest.cjs');
const { installationFor } = require('./capture.cjs');
const IMMUTABLE = new Set(['TournamentLockSnapshot', 'TournamentLatenessClaim', 'TournamentLatenessRequest']);
function analyze({ inventory, manifestDirectories = [], policy = APPROVED_POLICY, now = Date.now() }) {
  const blockers = new Set(['EXECUTOR_DISABLED']);
  let snapshot = null, manifestValid = true;
  const manifests = [], owned = new Map(), runs = new Set(), databaseTransactions = new Set();
  const attempt = fn => { try { return fn(); } catch (e) { blockers.add(/^[A-Z][A-Z0-9_]{0,63}$/.test(e.message) ? e.message : 'VALIDATION_FAILED'); return null; } };
  attempt(() => {
    check(policy.enabled === true && policy.keys, 'TARGET_NOT_APPROVED');
    snapshot = verify(inventory, policy.keys.inventory);
    check(snapshot.version === 1 && snapshot.kind === 'phase4-inventory', 'SNAPSHOT_VERSION');
    validateTarget(snapshot.identity, policy, now);
    installationFor(policy);
    validatePreservation(snapshot, policy);
    check(canonical(snapshot.tables) === canonical(TABLES) && canonical(Object.keys(snapshot.rows).sort()) === canonical(TABLES), 'TABLE_INVENTORY_DRIFT');
    check(snapshot.quiescence?.activeSessions === 0 && snapshot.quiescence.preparedTransactions === 0 && snapshot.quiescence.unresolvedOperations === 0, 'SESSIONS_UNSETTLED');
    check(Number.isSafeInteger(snapshot.lease?.fence) && snapshot.lease.fence > 0 && snapshot.lease.admissionClosed === true && Date.parse(snapshot.lease.validUntil) > now, 'LEASE_UNVERIFIED');
  });
  // Never use an unverified or incompletely validated snapshot as authoritative data.
  const inventoryTrusted = ![...blockers].some(b => b !== 'EXECUTOR_DISABLED');
  if (!inventoryTrusted) snapshot = null;
  if (snapshot) {
    if (!manifestDirectories.length) blockers.add('MANIFEST_MISSING');
    for (const directory of manifestDirectories) {
      const m = attempt(() => {
        check(!require('node:fs').existsSync(require('node:path').join(directory, '.writer-lock')), 'MANIFEST_WRITER_ACTIVE');
        const events = loadJournal(directory, policy.keys.manifest);
        check(events[0]?.leaseFence === snapshot.lease.fence, 'LEASE_FENCE_MISMATCH');
        return validateManifest(events, policy, digest(snapshot), now);
      });
      if (!m) { manifestValid = false; continue; }
      if (runs.has(m.runId)) { blockers.add('DUPLICATE_RUN'); manifestValid = false; continue; }
      runs.add(m.runId); manifests.push(m.runId);
      for (const xid of m.databaseTransactions) {
        if (databaseTransactions.has(xid)) { blockers.add('DATABASE_TRANSACTION_REPLAY'); manifestValid = false; }
        databaseTransactions.add(xid);
      }
      for (const [a, record] of m.owned) {
        if (owned.has(a)) { blockers.add('CROSS_RUN_OWNERSHIP'); manifestValid = false; }
        else owned.set(a, record);
      }
    }
  }
  if (!manifestValid) owned.clear(); // One inconsistent manifest invalidates the full deletion inventory.
  const records = new Map(), tables = [], dependencies = [];
  if (snapshot) for (const table of TABLES) {
    check(Array.isArray(snapshot.rows[table]), 'ROW_INVENTORY');
    const info = { table, total: snapshot.rows[table].length, owned: 0, unknown: 0, proposed: [], unknownRecords: [] };
    for (const row of snapshot.rows[table]) {
      const record = attempt(() => rowRecord(table, row));
      if (!record) { info.unknown++; continue; }
      const a = address(table, record.key), evidence = owned.get(a);
      if (records.has(a)) blockers.add('DUPLICATE_ROW');
      records.set(a, { ...record, owned: false });
      if (evidence && evidence.digest === record.digest && canonical(evidence.relationships) === canonical(record.relationships)) {
        info.owned++; records.get(a).owned = true;
        info.proposed.push({ key: record.key, fixtureId: evidence.fixtureId, runId: evidence.runId, caseId: evidence.caseId, transactionId: evidence.transactionId, digest: record.digest });
      } else { info.unknown++; info.unknownRecords.push({ key: record.key, reason: evidence ? 'OWNERSHIP_MISMATCH' : 'NO_CAPTURED_OWNERSHIP' }); }
      if (IMMUTABLE.has(table)) blockers.add('IMMUTABLE_HISTORY');
      if ((table === 'TournamentRegistration' && row.rosterLockedAt !== null) || (table === 'Tournament' && row.status === 'ROSTER_LOCKED')) blockers.add('LOCKED_FIXTURES');
    }
    if (info.unknown) blockers.add('UNKNOWN_RECORDS');
    tables.push(info);
  }
  for (const [a] of owned) if (!records.has(a)) blockers.add('OWNED_RECORD_MISSING');
  for (const [from, record] of records) for (const ref of record.relationships) {
    const targets = ref.tables ? ref.tables.map(t => address(t, { id: ref.value })).filter(a => records.has(a)) : [address(ref.table, ref.key)];
    if (targets.length !== 1 || !records.has(targets[0])) blockers.add('DEPENDENCY_UNRESOLVED');
    const to = targets.length === 1 ? targets[0] : null;
    if (to && record.owned !== records.get(to)?.owned) blockers.add('SHARED_DEPENDENCY');
    if (to && record.owned && owned.get(from)?.runId !== owned.get(to)?.runId) blockers.add('CROSS_RUN_DEPENDENCY');
    dependencies.push({ from, field: ref.field, to, resolved: to !== null && records.has(to) });
  }
  const report = { version: 1, mode: 'READ_ONLY', status: 'BLOCKED', executable: false, approvedDeletionCount: 0,
    targetDigest: policy.target ? digest(policy.target) : null, snapshotDigest: snapshot ? digest(snapshot) : null,
    manifests, tables, dependencies, catalogDependencies: snapshot?.objects.dependencies ?? [], blockers: [...blockers].sort() };
  return { ...report, reportDigest: digest(report) };
}
function verifyClean(before, after) {
  for (const field of ['project', 'branch', 'endpoint', 'hostname', 'database', 'databaseOid', 'role', 'expiresAt']) check(before.identity?.[field] === after.identity?.[field], 'DATABASE_CHANGED');
  check(canonical(after.tables) === canonical(TABLES) && canonical(Object.keys(after.rows).sort()) === canonical(TABLES), 'TABLE_INVENTORY_DRIFT');
  check(TABLES.every(t => Array.isArray(after.rows[t]) && after.rows[t].length === 0), 'APPLICATION_DATA_REMAINS');
  for (const field of ['ledger', 'catalog', 'objects', 'sequenceState']) check(canonical(before[field]) === canonical(after[field]), 'PRESERVATION_FAILED');
  return true; // Pure comparison only. Never grants execution or a reusable-state receipt.
}
module.exports = { analyze, verifyClean };
