'use strict';
// PREPARED ONLY. Requiring this module never imports PGlite or starts a database.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FOUNDATION_PIN = 'a8ae6fd95d38a2ea0192d471485e2fdf6abcb54f683d8ad0025bfd68088d73bc';
const QUERY_PIN = 'e222f922c259cb219ff88370cf8f47126230360606b9fe701b522aa56d46fca7';
const RUNTIME_PIN = '805fb863067224ff810f1f5739cd52a19a7a60059b4a43da79b431dc9ccad7ea';
const MAX_BYTES = 8 * 1024 * 1024;
const OPERATIONAL_POLICY = Object.freeze({ enabled: false, authorityKey: null, sandboxReceipt: null });
const requireSafe = (condition, code = 'REFERENCE_INPUT_REJECTED') => { if (!condition) throw Error(code); };
const canonical = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
};
const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && canonical(Object.keys(value).sort()) === canonical([...keys].sort());

function requireExecutionAuthority() {
  // No request field, environment variable, callback or CLI flag can activate it.
  requireSafe(OPERATIONAL_POLICY.enabled && OPERATIONAL_POLICY.authorityKey
    && OPERATIONAL_POLICY.sandboxReceipt, 'EXECUTION_DISABLED_PENDING_INDEPENDENT_APPROVAL');
}

function validateRequest(request) {
  requireSafe(exactKeys(request, ['format_version', 'foundation', 'queries', 'runtime', 'mode']));
  requireSafe(request.format_version === 1 && request.mode === 'fresh-memory-foundation-only');
  requireSafe(exactKeys(request.foundation, ['name', 'sha256', 'sql']));
  requireSafe(request.foundation.name === '20261012003031_foundation');
  requireSafe(request.foundation.sha256 === FOUNDATION_PIN && typeof request.foundation.sql === 'string');
  requireSafe(digest(request.foundation.sql) === FOUNDATION_PIN, 'FOUNDATION_HASH_MISMATCH');
  requireSafe(exactKeys(request.runtime, ['package_version', 'tree_sha256']));
  requireSafe(request.runtime.package_version === '0.5.10' && request.runtime.tree_sha256 === RUNTIME_PIN);
  requireSafe(digest(request.queries) === QUERY_PIN, 'REFERENCE_QUERY_HASH_MISMATCH');
  requireSafe(Buffer.byteLength(canonical(request)) <= MAX_BYTES);
  return request;
}

function validateRows(result, fields) {
  requireSafe(exactKeys(result, ['rows']) || (result && Array.isArray(result.rows)), 'CAPTURE_RESULT_INVALID');
  requireSafe(Array.isArray(result.rows) && result.rows.length <= 20000, 'CAPTURE_RESULT_INVALID');
  for (const row of result.rows) requireSafe(exactKeys(row, fields), 'CAPTURE_ROW_INCOMPLETE');
  return result.rows;
}

function assertCatalog(catalog) {
  const relations = catalog.Q2_relations;
  const tables = relations.filter(r => r.relkind === 'r' && r.schema_name === 'public');
  requireSafe(tables.length === 26 && new Set(tables.map(r => r.relname)).size === 26, 'FOUNDATION_TABLE_COUNT');
  requireSafe(relations.every(r => r.schema_name === 'public' && ['r', 'i'].includes(r.relkind)), 'UNEXPECTED_RELATION');
  requireSafe(catalog.Q3_columns.length === 192 && catalog.Q3_columns.every(r => r.attisdropped === false), 'FOUNDATION_COLUMNS');
  requireSafe(catalog.Q4_constraints.filter(r => r.contype === 'p').length === 26, 'FOUNDATION_PRIMARY_KEYS');
  requireSafe(catalog.Q4_constraints.filter(r => r.contype === 'f').length === 48, 'FOUNDATION_FOREIGN_KEYS');
  requireSafe(catalog.Q4_constraints.every(r => ['p', 'f', 'n'].includes(r.contype)), 'UNEXPECTED_CONSTRAINT');
  requireSafe(catalog.Q4_indexes.length === 52 && catalog.Q4_indexes.every(r =>
    r.indisvalid === true && r.indisready === true && r.indislive === true), 'FOUNDATION_INDEXES');
  requireSafe(catalog.Q5_enums.length === 67 && new Set(catalog.Q5_enums.map(r => r.typname)).size === 13, 'FOUNDATION_ENUMS');
  for (const section of ['Q5_sequences', 'Q6_routines', 'Q6_views', 'Q6_policies', 'Q7_rules']) {
    requireSafe(catalog[section].length === 0, 'UNEXPECTED_APPLICATION_OBJECT');
  }
  const fk = new Set(catalog.R_constraint_links.filter(r => r.kind === 'f')
    .map(r => canonical([r.schema_name, r.table_name, r.constraint_name])));
  requireSafe(fk.size === 48, 'CONSTRAINT_LINKS_INCOMPLETE');
  const seen = new Set();
  for (const trigger of catalog.R_trigger_links) {
    const key = canonical([trigger.constraint_schema, trigger.constraint_table, trigger.constraint_name]);
    requireSafe(trigger.internal === true && trigger.enabled === 'O' && fk.has(key)
      && trigger.function_schema === 'pg_catalog', 'TRIGGER_LINKS_INVALID');
    seen.add(key);
  }
  requireSafe(seen.size === 48 && catalog.Q6_triggers.length === catalog.R_trigger_links.length, 'TRIGGER_LINKS_INCOMPLETE');
  requireSafe(catalog.R_index_details.length === 52 && catalog.R_type_relationships.length > 0, 'GENERATED_OBJECTS_INCOMPLETE');
}

function artifactOf(request, engine, catalog, ledger) {
  assertCatalog(catalog);
  requireSafe(ledger.length === 0, 'UNEXPECTED_LEDGER');
  const q = request.queries;
  const security = new Set(q.security_fields);
  const application = Object.fromEntries(q.application_ids.map(id => [id,
    catalog[id].map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !security.has(key))))]));
  const applicationSecurity = Object.fromEntries(q.application_ids
    .filter(id => q.row_fields[id].some(key => security.has(key)))
    .map(id => [id, catalog[id].map(row => ({
      identity: Object.fromEntries(Object.entries(row).filter(([key]) => q.identity_fields.includes(key))),
      observations: Object.fromEntries(Object.entries(row).filter(([key]) => security.has(key))),
    }))]));
  const artifact = {
    format: 'phase4-foundation-reference', format_version: 1, status: 'UNREVIEWED',
    exact_match_enabled: false, reference_complete: false,
    provenance: { foundation_sha256: FOUNDATION_PIN, query_sha256: QUERY_PIN,
      runtime_tree_sha256: RUNTIME_PIN, package_version: '0.5.10', engine,
      creation_search_path: ['public', 'pg_catalog'], capture_search_path: ['pg_catalog'] },
    coverage: Object.fromEntries(Object.keys(q.queries).sort().map(id => [id, 'CAPTURED_UNREVIEWED'])),
    application,
    environment: { ...Object.fromEntries(q.environment_ids.map(id => [id, catalog[id]])),
      application_security: applicationSecurity },
    generated_objects: { types: application.R_type_relationships, constraints: application.R_constraint_links,
      indexes: application.R_index_details, triggers: application.R_trigger_links },
    ledger: { state: 'ABSENT', count: null, structure: 'NOT_DEFINED_BY_FOUNDATION' },
    review_required: ['SEMANTIC_COVERAGE', 'NORMALIZATION', 'PLATFORM_SECURITY', 'LEDGER_BASELINE', 'INDEPENDENT_OWNER_REVIEW'],
  };
  artifact.integrity = { algorithm: 'sha256', payload_sha256: digest(artifact), authenticity: 'NOT_ATTESTED' };
  requireSafe(Buffer.byteLength(canonical(artifact)) <= MAX_BYTES, 'ARTIFACT_TOO_LARGE');
  return artifact;
}

// Pure orchestration boundary, exported ONLY to exercise fake database clients.
// No caller of this function obtains execution authority or sandbox attestation.
async function captureWithFactory(request, createDatabase) {
  validateRequest(request); // Before any factory invocation.
  const db = await createDatabase(Object.freeze({ dataDir: 'memory://', extensions: Object.freeze({}) }));
  requireSafe(db && typeof db.query === 'function' && typeof db.exec === 'function' && typeof db.close === 'function');
  try {
    const [engine] = validateRows(await db.query(request.queries.engine), ['engine_version', 'server_version_num']);
    requireSafe(engine && engine.server_version_num === '180006'
      && /^PostgreSQL 18\.6(?:\s|$)/.test(engine.engine_version), 'ENGINE_VERSION_REJECTED');
    const [fresh] = validateRows(await db.query(request.queries.fresh),
      ['public_relations', 'public_types', 'public_routines', 'other_schemas', 'public_schemas']);
    requireSafe(fresh && fresh.public_schemas === 1 && ['public_relations', 'public_types', 'public_routines', 'other_schemas']
      .every(k => fresh[k] === 0), 'DATABASE_NOT_FRESH');
    for (const sql of request.queries.write_begin) await db.exec(sql);
    await db.exec(request.foundation.sql); // EXACTLY one hash-verified file, once.
    await db.exec(request.queries.write_finish);
    for (const sql of request.queries.read_begin) await db.exec(sql);
    const catalog = {};
    for (const [id, sql] of Object.entries(request.queries.queries)) {
      catalog[id] = validateRows(await db.query(sql), request.queries.row_fields[id]);
    }
    const identity = catalog.Q1_identity;
    requireSafe(identity.length === 1 && identity[0].read_only === 'on'
      && identity[0].isolation === 'repeatable read' && identity[0].statement_timeout === '10s'
      && identity[0].lock_timeout === '1s' && identity[0].idle_timeout === '30s', 'CAPTURE_TRANSACTION_UNSAFE');
    const ledger = validateRows(await db.query(request.queries.ledger), ['schema_name', 'relname', 'relkind']);
    await db.exec(request.queries.read_finish);
    return artifactOf(request, engine, catalog, ledger);
  } finally {
    // Close resources; no reset, deletion, retry or migration repair. A failed
    // transaction is abandoned with the private in-memory database, not repaired.
    await db.close();
  }
}

function verifiedRuntime(packageRoot) {
  requireSafe(!fs.lstatSync(packageRoot).isSymbolicLink(), 'RUNTIME_SYMLINK');
  const root = fs.realpathSync(packageRoot);
  const hashes = {};
  // Binary hashing must not pass through UTF-8 conversion.
  function binaryWalk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), info = fs.lstatSync(file);
      requireSafe(!info.isSymbolicLink(), 'RUNTIME_SYMLINK');
      if (info.isDirectory()) binaryWalk(file);
      else { requireSafe(info.isFile(), 'RUNTIME_SPECIAL_FILE'); hashes[path.relative(root, file).split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
    }
  }
  binaryWalk(root);
  requireSafe(digest(hashes) === RUNTIME_PIN, 'RUNTIME_DIGEST_MISMATCH');
  requireSafe(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version === '0.5.10');
  return root;
}

async function createApprovedDatabase() {
  requireExecutionAuthority(); // Never reached through any current CLI mode.
  const root = verifiedRuntime(path.resolve(__dirname, '../node_modules/@electric-sql/pglite'));
  const { PGlite } = require(root); // Lazy, hash-verified and behind the disabled gate.
  return new PGlite({ dataDir: 'memory://', extensions: {} });
}

async function main() {
  requireExecutionAuthority(); // Intentionally before stdin, filesystem or require(PGlite).
  // Activation needs a separate reviewed authority/sandbox binding implementation.
  // There is deliberately no operational input/driver-loading path in this phase.
  throw Error('EXECUTION_TRANSPORT_NOT_ACTIVATED');
}

module.exports = { validateRequest, validateRows, assertCatalog, artifactOf, captureWithFactory, createApprovedDatabase,
  verifiedRuntime, requireExecutionAuthority, canonical, digest, FOUNDATION_PIN, QUERY_PIN, RUNTIME_PIN };
if (require.main === module) main().catch(() => {
  process.stderr.write('REFERENCE_WORKER_EXECUTION_DISABLED\n'); process.exitCode = 3;
});
