"""Foundation-only reference query bundle. Data only; never executes SQL.

PG18 static review, NOT runtime validation. Production collector remains disabled.
The reference has no Prisma ledger; inspect its absence through catalogs only.
"""
import hashlib
import json

from phase4_foundation_queries import QUERIES as EXISTING

ENGINE_SQL = """SELECT version() AS engine_version,
 current_setting('server_version_num') AS server_version_num"""
FRESH_SQL = """SELECT
 (SELECT count(*)::int FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n
 ON n.oid=c.relnamespace WHERE n.nspname='public') AS public_relations,
 (SELECT count(*)::int FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n
 ON n.oid=t.typnamespace WHERE n.nspname='public') AS public_types,
 (SELECT count(*)::int FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n
 ON n.oid=p.pronamespace WHERE n.nspname='public') AS public_routines,
 (SELECT count(*)::int FROM pg_catalog.pg_namespace
 WHERE nspname !~ '^pg_' AND nspname NOT IN ('public','information_schema')) AS other_schemas,
 (SELECT count(*)::int FROM pg_catalog.pg_namespace WHERE nspname='public') AS public_schemas"""
WRITE_BEGIN = (
    'BEGIN', "SET LOCAL statement_timeout = '30s'",
    "SET LOCAL lock_timeout = '1s'", 'SET LOCAL search_path = public, pg_catalog',
)
READ_BEGIN = (
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    "SET LOCAL statement_timeout = '10s'", "SET LOCAL lock_timeout = '1s'",
    "SET LOCAL idle_in_transaction_session_timeout = '30s'",
    'SET LOCAL search_path = pg_catalog',
)

APPLICATION_IDS = (
    'Q2_relations', 'Q3_columns', 'Q4_constraints', 'Q4_indexes', 'Q5_types',
    'Q5_enums', 'Q5_sequences', 'Q6_routines', 'Q6_triggers', 'Q6_views',
    'Q6_policies', 'Q7_rules', 'Q7_unexpected',
    'R_type_relationships', 'R_constraint_links', 'R_index_details', 'R_trigger_links',
)
ENVIRONMENT_IDS = (
    'Q1_identity', 'Q2_schemas', 'Q7_relation_acl', 'Q7_column_acl', 'Q7_defaults',
    'Q7_extensions', 'Q7_event_triggers', 'R_environment',
)
SECURITY_FIELDS = ('owner_name', 'typacl', 'proacl')
IDENTITY_FIELDS = ('schema_name', 'relname', 'table_name', 'typname', 'proname', 'arguments', 'attname', 'index_name')
QUERIES = {name: EXISTING[name] for name in APPLICATION_IDS + ENVIRONMENT_IDS if name in EXISTING}
QUERIES.update({
    'R_type_relationships': """SELECT n.nspname AS schema_name,t.typname,t.typtype,
 en.nspname AS element_schema,et.typname AS element_type,
 rn.nspname AS relation_schema,r.relname AS relation_name,
 bn.nspname AS base_schema,bt.typname AS base_type,
 t.typnotnull,t.typdefault,t.typacl
 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
 LEFT JOIN pg_catalog.pg_type et ON et.oid=t.typelem
 LEFT JOIN pg_catalog.pg_namespace en ON en.oid=et.typnamespace
 LEFT JOIN pg_catalog.pg_class r ON r.oid=t.typrelid
 LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid=r.relnamespace
 LEFT JOIN pg_catalog.pg_type bt ON bt.oid=t.typbasetype
 LEFT JOIN pg_catalog.pg_namespace bn ON bn.oid=bt.typnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 ORDER BY n.nspname,t.typname""",
    'R_constraint_links': """SELECT n.nspname AS schema_name,c.relname AS table_name,
 x.conname AS constraint_name,x.contype AS kind,
 (SELECT jsonb_agg(a.attname ORDER BY k.position) FROM unnest(x.conkey)
 WITH ORDINALITY k(attnum,position) JOIN pg_catalog.pg_attribute a
 ON a.attrelid=x.conrelid AND a.attnum=k.attnum) AS key_columns,
 rn.nspname AS reference_schema,r.relname AS reference_table,
 (SELECT jsonb_agg(a.attname ORDER BY k.position) FROM unnest(x.confkey)
 WITH ORDINALITY k(attnum,position) JOIN pg_catalog.pg_attribute a
 ON a.attrelid=x.confrelid AND a.attnum=k.attnum) AS reference_columns,
 x.confupdtype AS update_action,x.confdeltype AS delete_action,
 x.confmatchtype AS match_type,ixn.nspname AS index_schema,ix.relname AS index_name,
 x.convalidated AS validated,x.condeferrable AS deferrable,x.condeferred AS deferred
 FROM pg_catalog.pg_constraint x JOIN pg_catalog.pg_class c ON c.oid=x.conrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_catalog.pg_class r ON r.oid=x.confrelid
 LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid=r.relnamespace
 LEFT JOIN pg_catalog.pg_class ix ON ix.oid=x.conindid
 LEFT JOIN pg_catalog.pg_namespace ixn ON ixn.oid=ix.relnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 ORDER BY n.nspname,c.relname,x.conname""",
    'R_index_details': """SELECT n.nspname AS schema_name,c.relname AS table_name,
 i.relname AS index_name,am.amname AS access_method,x.indnkeyatts,x.indnatts,
 (SELECT jsonb_agg(pg_catalog.pg_get_indexdef(i.oid,k.position::int,false)
 ORDER BY k.position) FROM unnest(x.indkey::smallint[]) WITH ORDINALITY
 k(attnum,position)) AS ordered_columns,
 (SELECT jsonb_agg(jsonb_build_array(pn.nspname,p.opcname) ORDER BY k.position)
 FROM unnest(x.indclass::oid[]) WITH ORDINALITY k(opclass,position)
 JOIN pg_catalog.pg_opclass p ON p.oid=k.opclass
 JOIN pg_catalog.pg_namespace pn ON pn.oid=p.opcnamespace) AS operator_classes,
 (SELECT jsonb_agg(jsonb_build_array(cn.nspname,co.collname) ORDER BY k.position)
 FROM unnest(x.indcollation::oid[]) WITH ORDINALITY k(collation,position)
 LEFT JOIN pg_catalog.pg_collation co ON co.oid=k.collation
 LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=co.collnamespace) AS collations,
 to_jsonb(x.indoption::smallint[]) AS ordered_option_flags,
 pg_catalog.pg_get_expr(x.indpred,x.indrelid) AS predicate,
 pg_catalog.pg_get_expr(x.indexprs,x.indrelid) AS expressions
 FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class c ON c.oid=x.indrelid
 JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_am am ON am.oid=i.relam
 WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 ORDER BY n.nspname,c.relname,i.relname""",
    'R_trigger_links': """SELECT n.nspname AS schema_name,c.relname AS table_name,
 t.tgname AS trigger_name,t.tgisinternal AS internal,t.tgenabled AS enabled,
 t.tgtype AS event_flags,pg_catalog.encode(t.tgargs,'hex') AS arguments_hex,
 t.tgdeferrable AS deferrable,t.tginitdeferred AS initially_deferred,
 pn.nspname AS function_schema,p.proname AS function_name,
 pg_catalog.pg_get_function_identity_arguments(p.oid) AS function_arguments,
 xn.nspname AS constraint_schema,xc.relname AS constraint_table,x.conname AS constraint_name
 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
 JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
 LEFT JOIN pg_catalog.pg_constraint x ON x.oid=t.tgconstraint
 LEFT JOIN pg_catalog.pg_class xc ON xc.oid=x.conrelid
 LEFT JOIN pg_catalog.pg_namespace xn ON xn.oid=xc.relnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 ORDER BY n.nspname,c.relname,t.tgname""",
    'R_environment': """SELECT current_database() AS database_name,current_user AS role_name,
 current_setting('server_encoding') AS server_encoding,
 current_setting('lc_collate') AS lc_collate,current_setting('lc_ctype') AS lc_ctype,
 current_setting('TimeZone') AS timezone,
 pg_catalog.pg_get_userbyid(d.datdba) AS database_owner,d.datacl,
 d.datlocprovider,d.datcollversion
 FROM pg_catalog.pg_database d WHERE d.datname=current_database()""",
})

# Ledger absence is a catalog observation, never a fabricated count of zero.
LEDGER_SQL = """SELECT n.nspname AS schema_name,c.relname,c.relkind
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='_prisma_migrations'"""

ROW_FIELDS = {
    'Q1_identity': 'database_name session_user current_user server_version_num read_only isolation statement_timeout lock_timeout idle_timeout',
    'Q2_schemas': 'schema_name owner_name nspacl',
    'Q2_relations': 'schema_name relname relkind relpersistence owner_name relrowsecurity relforcerowsecurity relreplident reloptions relispartition partition_key partition_bound',
    'Q3_columns': 'schema_name relname attnum attname attisdropped type_schema typname data_type attnotnull attidentity attgenerated default_expression collation_schema collname attstorage attcompression attoptions attfdwoptions',
    'Q4_constraints': 'schema_name relname conname contype definition convalidated condeferrable condeferred conislocal coninhcount connoinherit',
    'Q4_indexes': 'schema_name table_name index_name definition indisprimary indisunique indisexclusion indisvalid indisready indislive indimmediate indisreplident indnullsnotdistinct reloptions',
    'Q5_types': 'schema_name typname typtype owner_name has_relation has_element_type has_base_type',
    'Q5_enums': 'schema_name typname enumsortorder enumlabel',
    'Q5_sequences': 'schema_name relname owner_name data_type seqstart seqincrement seqmax seqmin seqcache seqcycle owning_schema owning_table owning_column deptype',
    'Q6_routines': 'schema_name proname prokind arguments owner_name prosecdef provolatile proleakproof proconfig proacl definition',
    'Q6_triggers': 'schema_name relname tgname tgisinternal tgenabled definition constraint_schema constraint_table conname contype',
    'Q6_views': 'schema_name relname relkind definition',
    'Q6_policies': 'schemaname tablename policyname permissive roles cmd qual with_check',
    'Q7_relation_acl': 'schema_name relname relkind owner_name grantee grantor privilege_type is_grantable',
    'Q7_column_acl': 'schema_name relname attname attacl',
    'Q7_defaults': 'role_name schema_name defaclobjtype defaclacl',
    'Q7_extensions': 'extname extversion schema_name',
    'Q7_event_triggers': 'evtname evtevent evtenabled evttags owner_name routine',
    'Q7_rules': 'schema_name relname rulename definition',
    'Q7_unexpected': 'identity deptype',
    'R_type_relationships': 'schema_name typname typtype element_schema element_type relation_schema relation_name base_schema base_type typnotnull typdefault typacl',
    'R_constraint_links': 'schema_name table_name constraint_name kind key_columns reference_schema reference_table reference_columns update_action delete_action match_type index_schema index_name validated deferrable deferred',
    'R_index_details': 'schema_name table_name index_name access_method indnkeyatts indnatts ordered_columns operator_classes collations ordered_option_flags predicate expressions',
    'R_trigger_links': 'schema_name table_name trigger_name internal enabled event_flags arguments_hex deferrable initially_deferred function_schema function_name function_arguments constraint_schema constraint_table constraint_name',
    'R_environment': 'database_name role_name server_encoding lc_collate lc_ctype timezone database_owner datacl datlocprovider datcollversion',
}


def bundle():
    return {'engine': ENGINE_SQL, 'fresh': FRESH_SQL, 'write_begin': list(WRITE_BEGIN),
            'write_finish': 'COMMIT', 'read_begin': list(READ_BEGIN),
            'read_finish': 'ROLLBACK', 'queries': QUERIES, 'ledger': LEDGER_SQL,
            'row_fields': {name: value.split() for name, value in ROW_FIELDS.items()},
            'security_fields': list(SECURITY_FIELDS), 'identity_fields': list(IDENTITY_FIELDS),
            'application_ids': list(APPLICATION_IDS), 'environment_ids': list(ENVIRONMENT_IDS)}


def digest():
    return hashlib.sha256(json.dumps(bundle(), sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def validate():
    value = bundle()
    if set(QUERIES) != set(APPLICATION_IDS + ENVIRONMENT_IDS) or set(ROW_FIELDS) != set(QUERIES):
        raise ValueError('REFERENCE_QUERY_COVERAGE')
    for sql in [ENGINE_SQL, FRESH_SQL, LEDGER_SQL, *QUERIES.values()]:
        if sql.split()[0] != 'SELECT' or ';' in sql or 'public."' in sql:
            raise ValueError('REFERENCE_QUERY_REJECTED')
    return value
