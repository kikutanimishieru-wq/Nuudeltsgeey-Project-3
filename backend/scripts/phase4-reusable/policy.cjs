'use strict';
const { requireSafe: check, digest, hash } = require('./common.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const BLOCKED_BRANCHES = Object.freeze(['br-wispy-mountain-b5nku4bf', 'br-plain-glitter-b5cadax8', 'br-morning-queen-b5u7j4qz', 'br-withered-mode-b528hnhk']);
const BLOCKED_ENDPOINTS = Object.freeze(['ep-crimson-rain-b5po4mqa', 'ep-wispy-voice-b4nvm1b4', 'ep-round-leaf-b5w0evea', 'ep-still-rain-b55chfrd', 'ep-delicate-poetry-b5bbwllj']);
// Deliberately no usable target or trust keys. No reusable database was provisioned/approved.
// Activation requires a reviewed source change and separate owner authorization.
const APPROVED_POLICY = Object.freeze({ version: 1, enabled: false, target: null, keys: null });
const PINS = Object.freeze({
  '20261012003031_foundation': 'a8ae6fd95d38a2ea0192d471485e2fdf6abcb54f683d8ad0025bfd68088d73bc',
  '20261016093000_identity_authority': '031afe0e48408fe46a517f7defae219d12b0f4bd09cfd416cbecb2e56c1eb07b',
  '20261016103000_identity_hardening': '9422261b8cbe4a86f09601d163aecc9f15a0465d89b094346678e43e0774262a',
  '20261016120000_tournament_configuration': '30df24fceee8eea8e02934a3e04e75223d2b66270bd5f152150a3a6b566b1296',
  '20261016150000_registration_lock': 'be091cdbc4d8cd92e086792c0f29bb191ac05dec6db7de0636dea3026ec82fa0',
  '20261016170000_final_attendance_governance': '66edc04a2b802a27acd73056562ad37f398d4fd0437fc9833f666f4766b3a254',
  '20261016190000_phase4_database_invariants': '3e015ab70b016845c35453414f935311c3183b89929ba56fc4918a5442225136',
});
function validateTarget(identity, policy = APPROVED_POLICY, now = Date.now()) {
  check(policy.version === 1 && policy.enabled === true && policy.target && policy.keys, 'TARGET_NOT_APPROVED');
  const t = policy.target;
  check(!BLOCKED_BRANCHES.includes(t.branch) && !BLOCKED_ENDPOINTS.includes(t.endpoint), 'HISTORICAL_TARGET');
  check(t.project === 'rough-snow-56584532' && /^br-[a-z0-9-]+$/.test(t.branch) && /^ep-[a-z0-9-]+$/.test(t.endpoint), 'TARGET_POLICY');
  check(t.hostname === t.endpoint + '.c-7.us-east-2.aws.neon.tech', 'HOST_POLICY');
  check(/^phase4_[a-z0-9_]+$/.test(t.database) && /^phase4_[a-z0-9_]+$/.test(t.role) && Number.isSafeInteger(t.databaseOid) && t.databaseOid > 0, 'DATABASE_POLICY');
  check(Number.isFinite(now) && Number.isFinite(Date.parse(t.expiresAt)) && Date.parse(t.expiresAt) - now >= 600000, 'TARGET_EXPIRED');
  const keyDigests = ['manifest', 'capture', 'inventory', 'database'].map(k => {
    try {
      const key = crypto.createPublicKey(policy.keys[k]);
      check(key.asymmetricKeyType === 'ed25519', 'TRUST_KEYS');
      return key.export({ type: 'spki', format: 'der' }).toString('hex');
    } catch { throw new Error('TRUST_KEYS'); }
  });
  check(new Set(keyDigests).size === 4, 'TRUST_KEYS');
  check(hash(policy.catalogDigest) && hash(policy.ledgerDigest) && hash(policy.sourceDigest), 'INSTALLATION_RECEIPT');
  for (const key of ['project', 'branch', 'endpoint', 'hostname', 'database', 'databaseOid', 'role', 'expiresAt']) check(identity?.[key] === t[key], 'TARGET_MISMATCH');
  check(identity.branchProject === t.project && identity.endpointBranch === t.branch, 'TARGET_ATTACHMENT');
  check(identity.ready === true && identity.primary === false && identity.default === false && identity.protected === false && identity.initSource === 'parent-schema', 'TARGET_PROTECTION');
  check(Array.isArray(identity.productionBranches) && Array.isArray(identity.productionEndpoints) && identity.productionBranches.length > 0 && identity.productionEndpoints.length > 0, 'PRODUCTION_INVENTORY');
  check(!identity.productionBranches.includes(t.branch) && !identity.productionEndpoints.includes(t.endpoint), 'PRODUCTION_TARGET');
  check(identity.tlsVerified === true && identity.direct === true && identity.workerRestricted === true && identity.schema === 'public', 'CONNECTION_ISOLATION');
  check(Number.isFinite(Date.parse(identity.observedAt)) && Date.parse(identity.observedAt) <= now && now - Date.parse(identity.observedAt) <= 60000, 'IDENTITY_STALE');
  return digest(t);
}
function validatePreservation(snapshot, policy) {
  check(policy.sourceDigest === sourceDigest(), 'SOURCE_DRIFT');
  const migrations = path.resolve(__dirname, '../../prisma/migrations');
  check(JSON.stringify(fs.readdirSync(migrations).filter(n => fs.statSync(path.join(migrations, n)).isDirectory()).sort()) === JSON.stringify(Object.keys(PINS)), 'LOCAL_MIGRATION_DRIFT');
  for (const [name, pin] of Object.entries(PINS)) check(crypto.createHash('sha256').update(fs.readFileSync(path.join(migrations, name, 'migration.sql'))).digest('hex') === pin, 'LOCAL_MIGRATION_DRIFT');
  check(snapshot.catalog && ['columns', 'constraints', 'indexes', 'enums', 'functions', 'triggers', 'security'].every(k => Object.hasOwn(snapshot.catalog, k)), 'CATALOG_INCOMPLETE');
  check(snapshot.objects && ['relations', 'sequences', 'dependencies', 'eventTriggers', 'extensions'].every(k => Array.isArray(snapshot.objects[k])), 'OBJECTS_INCOMPLETE');
  check(digest({ catalog: snapshot.catalog, objects: snapshot.objects }) === policy.catalogDigest, 'SCHEMA_DRIFT');
  check(Array.isArray(snapshot.ledger) && snapshot.ledger.length === 7 && digest(snapshot.ledger) === policy.ledgerDigest, 'LEDGER_DRIFT');
  check(snapshot.ledger.every((r, i) => r.migration_name === Object.keys(PINS)[i] && r.checksum === PINS[r.migration_name] && r.finished_at && r.rolled_back_at === null), 'LEDGER_PINS');
}
function sourceDigest() {
  const files = ['../phase4-native.ts', '../../prisma/schema.prisma', '../../lib/tournament-registration.ts', '../../lib/audit.ts', 'common.cjs', 'manifest.cjs', 'inventory.cjs', 'dry-run.cjs', 'executor.cjs', 'capture.cjs', 'fencing.cjs'];
  return digest(files.map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, f))).digest('hex')]));
}
module.exports = { APPROVED_POLICY, PINS, validateTarget, validatePreservation, sourceDigest };
