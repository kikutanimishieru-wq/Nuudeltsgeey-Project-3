'use strict';
const { Prisma } = require('@prisma/client');
const { metadataSql } = require('../phase4-schema-check.cjs');
const { requireSafe: check, canonical, digest } = require('./common.cjs');
const MODELS = Object.freeze(Object.fromEntries(Prisma.dmmf.datamodel.models.map(m => [m.name, {
  keys: m.primaryKey?.fields ?? m.fields.filter(f => f.isId).map(f => f.name),
  relations: m.fields.filter(f => f.kind === 'object' && f.relationFromFields?.length).map(f => ({ fields: f.relationFromFields, table: f.type, target: f.relationToFields })),
}])));
const TABLES = Object.freeze(Object.keys(MODELS).sort());
check(TABLES.length === 37, 'LOCAL_MODEL_DRIFT');
function keyOf(table, row) {
  check(MODELS[table] && row && typeof row === 'object', 'TABLE_OR_KEY');
  const key = Object.fromEntries(MODELS[table].keys.map(k => [k, row[k]]));
  check(Object.values(key).every(v => typeof v === 'string' || Number.isSafeInteger(v)), 'KEY_INCOMPLETE');
  return key;
}
function validateKey(table, key) { check(canonical(keyOf(table, key)) === canonical(key), 'KEY_SHAPE'); }
const address = (table, key) => table + ':' + canonical(key);
function references(table, row) {
  const refs = [];
  for (const relation of MODELS[table].relations) {
    check(relation.fields.every(f => Object.hasOwn(row, f)), 'RELATION_FIELD_MISSING');
    const values = relation.fields.map(f => row[f]);
    if (values.every(v => v === null)) continue;
    check(values.every(v => v !== null && v !== undefined), 'RELATION_INCOMPLETE');
    refs.push({ field: relation.fields.join(','), table: relation.table, key: Object.fromEntries(relation.target.map((k, i) => [k, values[i]])) });
  }
  // Polymorphic audit references must be resolved explicitly, never guessed from entityType.
  if (table === 'AuditEvent' && row.entityId !== null) refs.push({ field: 'entityId', value: row.entityId, tables: ['Tournament', 'TournamentRegistration', 'TournamentRosterMember', 'TournamentLatenessRequest'] });
  const mapping = { playerId: 'PlayerProfile', userId: 'User', teamId: 'Team', registrationId: 'TournamentRegistration', identityId: 'ExternalIdentity', requestId: 'TournamentLatenessRequest', claimId: 'TournamentLatenessClaim' };
  function embedded(value, field, depth = 0) {
    check(depth < 30, 'JSON_DEPTH');
    if (typeof value === 'string') {
      // Only the known audit roster fields contain JSON encoded as strings.
      if (field.endsWith('.previousRoster') || field.endsWith('.nextRoster')) {
        try { embedded(JSON.parse(value), field, depth + 1); } catch { throw new Error('JSON_REFERENCE_INVALID'); }
      }
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [k, v] of Object.entries(value)) {
      if (Object.hasOwn(mapping, k) && v !== null) {
        check(typeof v === 'string', 'JSON_REFERENCE_INVALID');
        refs.push({ field: field + '.' + k, table: mapping[k], key: { id: v } });
      } else {
        check(!/Id$/.test(k), 'UNKNOWN_JSON_REFERENCE');
        embedded(v, field + '.' + k, depth + 1);
      }
    }
  }
  if (table === 'TournamentLockSnapshot') embedded(row.snapshot, 'snapshot');
  if (table === 'AuditEvent') embedded(row.metadata, 'metadata');
  return refs.sort((a, b) => canonical(a).localeCompare(canonical(b)));
}
// One SELECT statement: table inventory, rows, ledger, catalog and object state share
// the statement snapshot. No connector, credentials, mutations or remote CLI exists here.
const SNAPSHOT_SQL = `SELECT jsonb_build_object(
 'tables',(SELECT jsonb_agg(table_name ORDER BY table_name) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'_prisma_migrations'),
 'rows',jsonb_build_object(${TABLES.map(t => `'${t}',(SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM public."${t}" r)`).join(',')}),
 'ledger',(SELECT jsonb_agg(to_jsonb(m) ORDER BY migration_name) FROM public."_prisma_migrations" m),
 'catalog',(${metadataSql}),
 'objects',jsonb_build_object(
  'relations',(SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,c.relkind,c.relowner,c.relpersistence,c.relispartition) ORDER BY c.relname),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
  'sequences',(SELECT coalesce(jsonb_agg(to_jsonb(s)-'last_value' ORDER BY sequencename),'[]'::jsonb) FROM pg_sequences s WHERE schemaname='public'),
  'dependencies',(SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,p.relname,pg_get_constraintdef(x.oid)) ORDER BY c.relname,x.conname),'[]'::jsonb) FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_class p ON p.oid=x.confrelid WHERE x.contype='f' AND (c.relnamespace='public'::regnamespace OR p.relnamespace='public'::regnamespace)),
  'eventTriggers',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY evtname),'[]'::jsonb) FROM pg_event_trigger e),
  'extensions',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY extname),'[]'::jsonb) FROM pg_extension e)
 ),
 'sequenceState',(SELECT coalesce(jsonb_agg(jsonb_build_array(sequencename,last_value) ORDER BY sequencename),'[]'::jsonb) FROM pg_sequences WHERE schemaname='public')
 ) AS snapshot`;
async function collectReadOnly(select) {
  check(typeof select === 'function', 'SELECT_ADAPTER_REQUIRED');
  const result = await select(SNAPSHOT_SQL); // Exactly one fixed SELECT; no retry.
  check(Array.isArray(result) && result.length === 1 && result[0].snapshot, 'SNAPSHOT_RESULT');
  return result[0].snapshot;
}
function rowRecord(table, row) { return { table, key: keyOf(table, row), digest: digest(row), relationships: references(table, row) }; }
module.exports = { TABLES, MODELS, keyOf, validateKey, address, references, rowRecord, SNAPSHOT_SQL, collectReadOnly };
