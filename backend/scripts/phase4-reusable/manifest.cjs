'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { requireSafe: check, canonical, digest, hash, sign, verify } = require('./common.cjs');
const { validateKey, address } = require('./inventory.cjs');
const CASES = require('../phase4-case-names.json');
const { verifyCapture, verifyRunSeal } = require('./capture.cjs');
const MAX_FILE = 16 * 1024 * 1024;
const runId = () => 'p4_' + randomUUID().replaceAll('-', '');
function privateStat(st, directory = false) {
  check((directory ? st.isDirectory() : st.isFile()) && st.uid === process.getuid() && (st.mode & 0o077) === 0 && (directory || st.nlink === 1), 'PRIVATE_FILE_REQUIRED');
}
function readPrivate(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { const st = fs.fstatSync(fd); privateStat(st); check(st.size <= MAX_FILE, 'FILE_TOO_LARGE'); return JSON.parse(fs.readFileSync(fd, 'utf8')); }
  finally { fs.closeSync(fd); }
}
function syncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function writeExclusive(file, value) {
  privateStat(fs.lstatSync(path.dirname(file)), true);
  check(fs.realpathSync(path.dirname(file)) === path.resolve(path.dirname(file)), 'SYMLINK_PATH');
  const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, canonical(value) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  syncDirectory(path.dirname(file));
}
// Append-only signed chain. A crash leaves a lock or a truncated event => blocked;
// nothing is overwritten, repaired, discarded or retried automatically.
class ManifestWriter {
  constructor(directory, privateKey, publicKey) {
    privateStat(fs.lstatSync(directory), true);
    check(fs.realpathSync(directory) === path.resolve(directory), 'SYMLINK_PATH');
    this.directory = directory; this.privateKey = privateKey; this.publicKey = publicKey;
    this.lock = path.join(directory, '.writer-lock');
    writeExclusive(this.lock, { pid: process.pid });
    this.sequence = 0; this.previous = null; this.closed = false;
    try {
      const events = loadJournal(directory, publicKey);
      this.sequence = events.length;
      if (events.length) this.previous = digest(readPrivate(path.join(directory, `${String(events.length - 1).padStart(8, '0')}.json`)));
    } catch (error) { this.close(); throw error; }
  }
  append(event) {
    check(!this.closed && !this.failed, 'WRITER_CLOSED');
    const envelope = sign({ version: 1, sequence: this.sequence, previous: this.previous, event }, this.privateKey);
    verify(envelope, this.publicKey);
    try { writeExclusive(path.join(this.directory, `${String(this.sequence).padStart(8, '0')}.json`), envelope); }
    catch (error) { this.failed = true; throw error; }
    this.previous = digest(envelope); this.sequence++;
    return envelope;
  }
  close() {
    if (!this.closed) { fs.unlinkSync(this.lock); syncDirectory(this.directory); this.closed = true; }
  }
}
function loadJournal(directory, publicKey) {
  privateStat(fs.lstatSync(directory), true);
  check(fs.realpathSync(directory) === path.resolve(directory), 'SYMLINK_PATH');
  const names = fs.readdirSync(directory).filter(n => n !== '.writer-lock').sort();
  check(names.length <= 10000, 'JOURNAL_TOO_LARGE');
  let previous = null;
  return names.map((name, sequence) => {
    check(name === `${String(sequence).padStart(8, '0')}.json`, 'JOURNAL_GAP');
    const envelope = readPrivate(path.join(directory, name));
    const p = verify(envelope, publicKey);
    check(p.version === 1 && p.sequence === sequence && p.previous === previous, 'JOURNAL_CHAIN');
    previous = digest(envelope);
    return p.event;
  });
}
function validateManifest(events, policy, snapshotDigest, now = Date.now()) {
  check(Array.isArray(events) && events.length > 0, 'MANIFEST_MISSING');
  const header = events[0];
  check(header.type === 'run' && header.version === 1 && /^p4_[a-f0-9]{32}$/.test(header.runId), 'MANIFEST_HEADER');
  check(header.targetDigest === digest(policy.target) && header.sourceDigest === policy.sourceDigest && header.catalogDigest === policy.catalogDigest && header.ledgerDigest === policy.ledgerDigest && hash(header.authorizationDigest), 'MANIFEST_BINDING');
  const transactions = new Map(), owned = new Map(), fixtureIds = new Map(), sessions = new Map(), groups = new Map();
  const databaseTransactions = new Set();
  let ended = false;
  for (const event of events.slice(1)) {
    check(!ended, 'EVENT_AFTER_END');
    if (event.type === 'intent') {
      check(CASES[event.caseId] && typeof event.transactionId === 'string' && /^[a-f0-9-]{36}$/.test(event.transactionId) && !transactions.has(event.transactionId), 'TRANSACTION_INTENT');
      check(Array.isArray(event.tables) && event.tables.length > 0 && new Set(event.tables).size === event.tables.length && event.tables.every(t => require('./inventory.cjs').TABLES.includes(t)), 'INTENT_TABLES');
      check(Array.isArray(event.fixtures), 'INTENT_FIXTURES');
      if (event.concurrencyGroup !== undefined) check(/^[a-f0-9-]{36}$/.test(event.concurrencyGroup), 'CONCURRENCY_GROUP');
      for (const f of event.fixtures) { validateKey(f.table, f.key); check(event.tables.includes(f.table), 'INTENT_TABLE'); }
      transactions.set(event.transactionId, { intent: event, receipt: null });
    } else if (event.type === 'receipt') {
      // Verify the outer signature before looking up its transaction; a claimed
      // outcome is never used until independent database evidence verifies too.
      const claimed = verify(event.envelope, policy.keys.capture);
      const tx = transactions.get(claimed.transactionId);
      check(tx && !tx.receipt, 'CAPTURE_BINDING');
      const receipt = verifyCapture(event.envelope, policy, { runId: header.runId, targetDigest: header.targetDigest, leaseFence: header.leaseFence, transactionId: tx.intent.transactionId, caseId: tx.intent.caseId, intentDigest: digest(tx.intent) }, now);
      const databaseTransaction = receipt.databaseEvidence.payload.epoch + ':' + receipt.databaseEvidence.payload.xid;
      check(!databaseTransactions.has(databaseTransaction), 'DATABASE_TRANSACTION_REPLAY');
      databaseTransactions.add(databaseTransaction);
      check(['COMMITTED', 'ROLLED_BACK', 'UNKNOWN'].includes(receipt.outcome) && Array.isArray(receipt.operations), 'CAPTURE_OUTCOME');
      check(receipt.session && Number.isInteger(receipt.session.pid) && receipt.session.pid > 0 && typeof receipt.session.backendStart === 'string' && Number.isFinite(Date.parse(receipt.session.backendStart)) && typeof receipt.session.id === 'string' && receipt.session.id.length > 0, 'SESSION_REQUIRED');
      const sessionKey = receipt.session.pid + ':' + receipt.session.backendStart;
      if (sessions.has(receipt.session.id)) check(sessions.get(receipt.session.id) === sessionKey, 'SESSION_ALIAS');
      sessions.set(receipt.session.id, sessionKey);
      if (tx.intent.concurrencyGroup) {
        const group = groups.get(tx.intent.concurrencyGroup) ?? [];
        group.push(sessionKey); groups.set(tx.intent.concurrencyGroup, group);
      }
      check(receipt.outcome === 'COMMITTED' || receipt.operations.length === 0, 'UNCOMMITTED_OPERATIONS');
      for (const operation of receipt.operations) {
        check(['insert', 'update', 'delete'].includes(operation.operation) && tx.intent.tables.includes(operation.table), 'OPERATION_SCOPE');
        validateKey(operation.table, operation.key);
        check(/^[a-f0-9-]{36}$/.test(operation.fixtureId) && hash(operation.digest) && Array.isArray(operation.relationships), 'FIXTURE_RECORD');
        const a = address(operation.table, operation.key), prior = owned.get(a);
        if (operation.operation === 'insert') check(!prior && !fixtureIds.has(operation.fixtureId), 'OWNERSHIP_DUPLICATE');
        else check(prior && prior.fixtureId === operation.fixtureId && prior.digest === operation.beforeDigest, 'MUTATION_WITHOUT_OWNERSHIP');
        if (operation.operation === 'delete') owned.delete(a);
        else owned.set(a, { ...operation, runId: header.runId, transactionId: receipt.transactionId, session: receipt.session, caseId: receipt.caseId });
        fixtureIds.set(operation.fixtureId, a);
      }
      // Known keys must be covered by capture; server-generated keys require capture
      // authority, never a scan of current rows or a worker's self-attestation.
      if (receipt.outcome === 'COMMITTED') for (const f of tx.intent.fixtures) check(receipt.operations.some(o => o.table === f.table && canonical(o.key) === canonical(f.key)), 'INTENT_NOT_CAPTURED');
      tx.receipt = receipt;
    } else if (event.type === 'end') {
      check(['PASSED', 'FAILED', 'INTERRUPTED'].includes(event.state), 'RUN_STATE');
      check(event.snapshotDigest === snapshotDigest && hash(snapshotDigest), 'MANIFEST_INCOMPLETE');
      verifyRunSeal(event.captureSeal, policy, header, [...transactions.values()].map(t => t.receipt).filter(Boolean), snapshotDigest);
      ended = true;
    } else throw new Error('UNKNOWN_MANIFEST_EVENT');
  }
  check(ended && [...transactions.values()].every(t => t.receipt && t.receipt.outcome !== 'UNKNOWN'), 'UNSETTLED_TRANSACTIONS');
  check([...groups.values()].every(g => g.length >= 2 && new Set(g).size === g.length), 'CONCURRENCY_SESSIONS_NOT_DISTINCT');
  return { runId: header.runId, owned, sessions, databaseTransactions };
}
module.exports = { runId, ManifestWriter, loadJournal, validateManifest, readPrivate, writeExclusive };
