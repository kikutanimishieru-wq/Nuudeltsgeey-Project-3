'use strict';
// MOCKS ONLY. Input is a local request fixture, NOT a database/reference artifact.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name.includes('@electric-sql/pglite') || name.includes('pglite.wasm')) throw Error('REAL_DATABASE_IMPORT_FORBIDDEN');
  return originalLoad.call(this, name, ...args);
};
const w = require('./phase4-foundation-reference-worker.cjs');
assert(process.env.PHASE4_REFERENCE_MOCK_INPUT, 'provide the offline request fixture path');
const input = JSON.parse(fs.readFileSync(process.env.PHASE4_REFERENCE_MOCK_INPUT, 'utf8'));
const clone = x => JSON.parse(JSON.stringify(x));
const makeRow = (id, changes = {}) => Object.assign(Object.fromEntries(input.queries.row_fields[id].map(k => [k, null])), changes);

function simulatedCatalog() {
  // Explicitly synthetic catalog facts. No parser/database generates expected and
  // actual catalogs, and these fixtures can NEVER certify reference completeness.
  const c = Object.fromEntries(Object.keys(input.queries.queries).map(id => [id, []]));
  for (let i = 0; i < 26; i++) c.Q2_relations.push(makeRow('Q2_relations', { schema_name: 'public', relname: 'MockTable' + i, relkind: 'r' }));
  for (let i = 0; i < 192; i++) c.Q3_columns.push(makeRow('Q3_columns', { schema_name: 'public', relname: 'MockTable0', attname: 'mock' + i, attisdropped: false }));
  for (let i = 0; i < 26; i++) c.Q4_constraints.push(makeRow('Q4_constraints', { contype: 'p' }));
  for (let i = 0; i < 48; i++) {
    c.Q4_constraints.push(makeRow('Q4_constraints', { contype: 'f' }));
    c.R_constraint_links.push(makeRow('R_constraint_links', { schema_name: 'public', table_name: 'MockTable0', constraint_name: 'MockFK' + i, kind: 'f' }));
    c.R_trigger_links.push(makeRow('R_trigger_links', { internal: true, enabled: 'O', function_schema: 'pg_catalog',
      constraint_schema: 'public', constraint_table: 'MockTable0', constraint_name: 'MockFK' + i }));
    c.Q6_triggers.push(makeRow('Q6_triggers', { tgisinternal: true }));
  }
  for (let i = 0; i < 52; i++) {
    c.Q4_indexes.push(makeRow('Q4_indexes', { indisvalid: true, indisready: true, indislive: true }));
    c.R_index_details.push(makeRow('R_index_details'));
  }
  for (let i = 0; i < 67; i++) c.Q5_enums.push(makeRow('Q5_enums', { typname: 'MockEnum' + i % 13 }));
  c.R_type_relationships.push(makeRow('R_type_relationships'));
  c.Q1_identity.push(makeRow('Q1_identity', { read_only: 'on', isolation: 'repeatable read', statement_timeout: '10s', lock_timeout: '1s', idle_timeout: '30s' }));
  return c;
}

function fakeDatabase({ catalog = simulatedCatalog(), failSql = null, nonempty = false, ledger = [], version = '180006' } = {}) {
  const calls = [], sqlIds = Object.fromEntries(Object.entries(input.queries.queries).map(([id, sql]) => [sql, id]));
  let closes = 0;
  return {
    calls, catalog, get closes() { return closes; },
    async exec(sql) { calls.push(['exec', sql]); if (sql === failSql) throw Error('SENSITIVE_SQL_ERROR'); },
    async query(sql) {
      calls.push(['query', sql]); if (sql === failSql) throw Error('SENSITIVE_SQL_ERROR');
      if (sql === input.queries.engine) return { rows: [{ engine_version: 'PostgreSQL 18.6 MOCK', server_version_num: version }] };
      if (sql === input.queries.fresh) return { rows: [{ public_relations: nonempty ? 1 : 0, public_types: 0, public_routines: 0, other_schemas: 0, public_schemas: 1 }] };
      if (sql === input.queries.ledger) return { rows: ledger };
      assert(sqlIds[sql], 'only fixed queries may be called');
      return { rows: catalog[sqlIds[sql]] };
    },
    async close() { closes++; },
  };
}

test('worker import and authority checks cannot load PGlite or accept claimed approval', async () => {
  assert.throws(() => w.requireExecutionAuthority({ approved: true }), /EXECUTION_DISABLED/);
  await assert.rejects(w.createApprovedDatabase(), /EXECUTION_DISABLED/);
  assert.throws(() => require('@electric-sql/pglite'), /REAL_DATABASE_IMPORT_FORBIDDEN/);
});

test('request pins foundation runtime and query bundle', () => {
  assert.equal(w.validateRequest(input), input);
  for (const mutate of [r => r.foundation.sql += '\n', r => r.foundation.sha256 = 'forged',
    r => r.runtime.tree_sha256 = 'forged', r => r.runtime.package_version = 'other',
    r => r.queries.queries.Q2_relations = 'SELECT evil()']) {
    const r = clone(input); mutate(r); assert.throws(() => w.validateRequest(r));
  }
});

test('wrong migration all-seven list reused directory and connection settings rejected before factory', async () => {
  for (const mutate of [r => r.foundation.name = '20261016190000_phase4_database_invariants',
    r => r.migrations = Array(7).fill(r.foundation), r => r.dataDir = '/existing',
    r => r.url = 'postgresql://SECRET', r => r.mode = 'existing-database', r => r.approved = true]) {
    const r = clone(input); mutate(r); let calls = 0;
    await assert.rejects(w.captureWithFactory(r, () => { calls++; }));
    assert.equal(calls, 0);
  }
});

test('fresh memory configuration only and exactly one foundation execution', async () => {
  const db = fakeDatabase(); let creates = 0;
  const artifact = await w.captureWithFactory(input, async options => {
    creates++; assert.deepEqual(options, { dataDir: 'memory://', extensions: {} }); return db;
  });
  assert.equal(creates, 1);
  assert.equal(db.calls.filter(([kind, sql]) => kind === 'exec' && sql === input.foundation.sql).length, 1);
  assert.equal(db.closes, 1);
  assert.equal(artifact.status, 'UNREVIEWED');
  assert.equal(artifact.reference_complete, false);
  assert.equal(artifact.exact_match_enabled, false);
  assert.equal(artifact.integrity.authenticity, 'NOT_ATTESTED');
  const payload = { ...artifact }; delete payload.integrity;
  assert.equal(w.digest(payload), artifact.integrity.payload_sha256);
});

test('reference partitions application generated environment and absent ledger', async () => {
  const artifact = await w.captureWithFactory(input, async () => fakeDatabase());
  assert.deepEqual(Object.keys(artifact.application).sort(), [...input.queries.application_ids].sort());
  assert.deepEqual(Object.keys(artifact.environment).sort(), [...input.queries.environment_ids, 'application_security'].sort());
  assert.deepEqual(artifact.generated_objects.triggers, artifact.application.R_trigger_links);
  assert(!Object.hasOwn(artifact.application.Q2_relations[0], 'owner_name'));
  assert(Object.hasOwn(artifact.environment.application_security.Q2_relations[0].observations, 'owner_name'));
  assert.deepEqual(artifact.ledger, { state: 'ABSENT', count: null, structure: 'NOT_DEFINED_BY_FOUNDATION' });
  assert.equal(artifact.coverage.R_type_relationships, 'CAPTURED_UNREVIEWED');
});

test('existing database stops before migration', async () => {
  const db = fakeDatabase({ nonempty: true });
  await assert.rejects(w.captureWithFactory(input, async () => db), /DATABASE_NOT_FRESH/);
  assert.equal(db.calls.filter(([kind]) => kind === 'exec').length, 0);
  assert.equal(db.closes, 1);
});

test('wrong actual engine version stops before migration', async () => {
  const db = fakeDatabase({ version: '170000' });
  await assert.rejects(w.captureWithFactory(input, async () => db), /ENGINE_VERSION_REJECTED/);
  assert.equal(db.calls.filter(([kind]) => kind === 'exec').length, 0);
});

test('SQL failure closes only no retry repair reset cleanup or artifact', async () => {
  const db = fakeDatabase({ failSql: input.foundation.sql }); let creates = 0;
  await assert.rejects(w.captureWithFactory(input, async () => { creates++; return db; }), /SENSITIVE_SQL_ERROR/);
  assert.equal(creates, 1); assert.equal(db.closes, 1);
  assert.equal(db.calls.filter(([, sql]) => sql === input.foundation.sql).length, 1);
  assert(!db.calls.some(([, sql]) => /TRUNCATE|DROP SCHEMA|DISABLE TRIGGER|RESET ALL/.test(sql)));
});

test('capture query failure no automatic retry', async () => {
  const sql = input.queries.queries.Q3_columns, db = fakeDatabase({ failSql: sql });
  await assert.rejects(w.captureWithFactory(input, async () => db), /SENSITIVE_SQL_ERROR/);
  assert.equal(db.calls.filter(([, query]) => query === sql).length, 1);
});

test('missing row fields or missing results fail closed', async () => {
  for (const change of [c => delete c.Q3_columns[0].data_type, c => c.Q3_columns = null,
    c => c.Q4_constraints[0].unexpected = true]) {
    const c = simulatedCatalog(); change(c);
    await assert.rejects(w.captureWithFactory(input, async () => fakeDatabase({ catalog: c })), /CAPTURE/);
  }
});

test('catalog count invalid index and unlinked trigger blockers', async () => {
  for (const change of [c => c.Q2_relations.pop(), c => c.Q5_enums.pop(),
    c => c.Q4_indexes[0].indisvalid = false,
    c => c.R_trigger_links[0].internal = false,
    c => c.R_trigger_links[0].constraint_name = 'unknown',
    c => c.R_type_relationships = []]) {
    const c = simulatedCatalog(); change(c);
    await assert.rejects(w.captureWithFactory(input, async () => fakeDatabase({ catalog: c })));
  }
});

test('unsafe capture transaction metadata blocks', async () => {
  const c = simulatedCatalog(); c.Q1_identity[0].read_only = 'off';
  await assert.rejects(w.captureWithFactory(input, async () => fakeDatabase({ catalog: c })), /CAPTURE_TRANSACTION_UNSAFE/);
});

test('unexpected Prisma ledger is not counted or adopted', async () => {
  const db = fakeDatabase({ ledger: [{ schema_name: 'public', relname: '_prisma_migrations', relkind: 'r' }] });
  await assert.rejects(w.captureWithFactory(input, async () => db), /UNEXPECTED_LEDGER/);
  assert(!db.calls.some(([, sql]) => /FROM public\."_prisma_migrations"/.test(sql)));
});

test('unknown CLI cannot activate worker source has no PGlite constructor import', () => {
  const source = fs.readFileSync(__dirname + '/phase4-foundation-reference-worker.cjs', 'utf8');
  assert(!/require\(['"]@electric-sql\/pglite['"]\)/.test(source));
  assert(!source.includes('process.env'));
  assert(source.includes('EXECUTION_TRANSPORT_NOT_ACTIVATED'));
});
