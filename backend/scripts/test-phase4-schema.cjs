// Only SELECT queries on disposable memory. No migration or remote path is invoked.
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { metadataSql } = require('./phase4-schema-check.cjs');

test('expanded catalog query executes using read-only SELECTs', { skip: process.env.PHASE4_NO_DATABASE_TESTS === '1' || process.env.PHASE4_ALLOW_LOCAL_SQL_TESTS !== '1' }, async () => {
 const db = new PGlite();
 try {
  const result = await db.query(metadataSql);
  const metadata = result.rows[0].metadata;
  assert.equal(metadata.columns, null);
  assert.equal(metadata.triggers, null);
  assert.deepEqual(Object.keys(metadata.security).sort(), [
   'relations', 'table_acl', 'column_acl', 'schema_acl', 'other_schemas',
   'policies', 'views', 'function_acl', 'other_types'
  ].sort());
  assert.equal(metadata.security.policies, null);
  assert.equal(metadata.security.views, null);
  assert.ok(metadata.security.schema_acl.length > 0);
 } finally { await db.close(); }
});
