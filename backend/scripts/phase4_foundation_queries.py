"""Inert PG18 catalog query plan. No driver, credentials, callbacks or execution.

Static review only: these statements have NOT been validated by PostgreSQL.
The future collector/row adapter requires separate implementation and review.
"""

TRANSACTION = (
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    "SET LOCAL statement_timeout = '10s'",
    "SET LOCAL lock_timeout = '1s'",
    "SET LOCAL idle_in_transaction_session_timeout = '30s'",
    'SET LOCAL search_path = pg_catalog',
)
FINISH = 'ROLLBACK'
MIN_SERVER_VERSION = 180000
MAX_SERVER_VERSION = 189999

# Fixed strings only. Never interpolate a caller-supplied schema, table or query.
QUERIES = {
    'Q1_identity': """SELECT current_database() AS database_name, session_user,
 current_user, current_setting('server_version_num') AS server_version_num,
 current_setting('transaction_read_only') AS read_only,
 current_setting('transaction_isolation') AS isolation,
 current_setting('statement_timeout') AS statement_timeout,
 current_setting('lock_timeout') AS lock_timeout,
 current_setting('idle_in_transaction_session_timeout') AS idle_timeout""",
    'Q1_tls': """SELECT ssl, version, cipher, bits FROM pg_catalog.pg_stat_ssl
 WHERE pid = pg_catalog.pg_backend_pid()""",
    'Q2_schemas': """SELECT n.nspname AS schema_name,
 pg_catalog.pg_get_userbyid(n.nspowner) AS owner_name, n.nspacl
 FROM pg_catalog.pg_namespace n
 WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 ORDER BY n.nspname""",
    'Q2_relations': """SELECT n.nspname AS schema_name, c.relname, c.relkind,
 c.relpersistence, pg_catalog.pg_get_userbyid(c.relowner) AS owner_name,
 c.relrowsecurity, c.relforcerowsecurity, c.relreplident, c.reloptions,
 c.relispartition, pg_catalog.pg_get_partkeydef(c.oid) AS partition_key,
 pg_catalog.pg_get_expr(c.relpartbound,c.oid) AS partition_bound
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 ORDER BY n.nspname,c.relname""",
    'Q3_columns': """SELECT n.nspname AS schema_name,c.relname,a.attnum,a.attname,
 a.attisdropped,tn.nspname AS type_schema,t.typname,
 pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,
 a.attnotnull,a.attidentity,a.attgenerated,
 pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression,
 cn.nspname AS collation_schema,co.collname,a.attstorage,a.attcompression,
 a.attoptions,a.attfdwoptions
 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
 JOIN pg_catalog.pg_namespace tn ON tn.oid=t.typnamespace
 LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 LEFT JOIN pg_catalog.pg_collation co ON co.oid=a.attcollation
 LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=co.collnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0
 ORDER BY n.nspname,c.relname,a.attnum""",
    'Q4_constraints': """SELECT n.nspname AS schema_name,c.relname,x.conname,
 x.contype,pg_catalog.pg_get_constraintdef(x.oid,false) AS definition,
 x.convalidated,x.condeferrable,x.condeferred,x.conislocal,x.coninhcount,
 x.connoinherit
 FROM pg_catalog.pg_constraint x JOIN pg_catalog.pg_class c ON c.oid=x.conrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 ORDER BY n.nspname,c.relname,x.conname""",
    'Q4_indexes': """SELECT n.nspname AS schema_name,c.relname AS table_name,
 i.relname AS index_name,pg_catalog.pg_get_indexdef(i.oid,0,false) AS definition,
 x.indisprimary,x.indisunique,x.indisexclusion,x.indisvalid,x.indisready,
 x.indislive,x.indimmediate,x.indisreplident,x.indnullsnotdistinct,i.reloptions
 FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class c ON c.oid=x.indrelid
 JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 ORDER BY n.nspname,c.relname,i.relname""",
    'Q5_types': """SELECT n.nspname AS schema_name,t.typname,t.typtype,
 pg_catalog.pg_get_userbyid(t.typowner) AS owner_name,
 t.typrelid<>0 AS has_relation,t.typelem<>0 AS has_element_type,
 t.typbasetype<>0 AS has_base_type
 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 ORDER BY n.nspname,t.typname""",
    'Q5_enums': """SELECT n.nspname AS schema_name,t.typname,e.enumsortorder,e.enumlabel
 FROM pg_catalog.pg_enum e JOIN pg_catalog.pg_type t ON t.oid=e.enumtypid
 JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 ORDER BY n.nspname,t.typname,e.enumsortorder""",
    'Q5_sequences': """SELECT n.nspname AS schema_name,c.relname,
 pg_catalog.pg_get_userbyid(c.relowner) AS owner_name,
 pg_catalog.format_type(s.seqtypid,NULL) AS data_type,
 s.seqstart,s.seqincrement,s.seqmax,s.seqmin,s.seqcache,s.seqcycle,
 rn.nspname AS owning_schema,r.relname AS owning_table,
 a.attname AS owning_column,d.deptype
 FROM pg_catalog.pg_sequence s JOIN pg_catalog.pg_class c ON c.oid=s.seqrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_catalog.pg_depend d ON d.classid='pg_catalog.pg_class'::regclass
 AND d.objid=c.oid AND d.objsubid=0
 AND d.refclassid='pg_catalog.pg_class'::regclass AND d.deptype IN ('a','i')
 LEFT JOIN pg_catalog.pg_class r ON r.oid=d.refobjid
 LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid=r.relnamespace
 LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
 WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 ORDER BY n.nspname,c.relname""",
    'Q6_routines': """SELECT n.nspname AS schema_name,p.proname,p.prokind,
 pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
 pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
 p.prosecdef,p.provolatile,p.proleakproof,p.proconfig,p.proacl,
 CASE WHEN p.prokind IN ('f','p') THEN pg_catalog.pg_get_functiondef(p.oid) END AS definition
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 ORDER BY n.nspname,p.proname,arguments""",
    'Q6_triggers': """SELECT n.nspname AS schema_name,c.relname,t.tgname,
 t.tgisinternal,t.tgenabled,
 pg_catalog.pg_get_triggerdef(t.oid,false) AS definition,
 xn.nspname AS constraint_schema,xc.relname AS constraint_table,
 x.conname,x.contype
 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_catalog.pg_constraint x ON x.oid=t.tgconstraint
 LEFT JOIN pg_catalog.pg_class xc ON xc.oid=x.conrelid
 LEFT JOIN pg_catalog.pg_namespace xn ON xn.oid=xc.relnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 ORDER BY n.nspname,c.relname,t.tgname""",
    'Q6_views': """SELECT n.nspname AS schema_name,c.relname,c.relkind,
 pg_catalog.pg_get_viewdef(c.oid,false) AS definition
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 AND c.relkind IN ('v','m') ORDER BY n.nspname,c.relname""",
    'Q6_policies': """SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
 FROM pg_catalog.pg_policies WHERE schemaname !~ '^pg_' AND schemaname<>'information_schema'
 ORDER BY schemaname,tablename,policyname""",
    'Q7_relation_acl': """SELECT n.nspname AS schema_name,c.relname,c.relkind,
 pg_catalog.pg_get_userbyid(c.relowner) AS owner_name,
 CASE WHEN a.grantee=c.relowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC'
 ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS grantee,
 CASE WHEN a.grantor=c.relowner THEN 'OWNER'
 ELSE pg_catalog.pg_get_userbyid(a.grantor) END AS grantor,
 a.privilege_type,a.is_grantable
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,
 pg_catalog.acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a
 WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 AND c.relkind IN ('r','p','v','m','S','f')
 ORDER BY n.nspname,c.relname,grantee,grantor,a.privilege_type,a.is_grantable""",
    'Q7_column_acl': """SELECT n.nspname AS schema_name,c.relname,a.attname,a.attacl
 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
 ORDER BY n.nspname,c.relname,a.attnum""",
    'Q7_defaults': """SELECT pg_catalog.pg_get_userbyid(d.defaclrole) AS role_name,
 n.nspname AS schema_name,d.defaclobjtype,d.defaclacl
 FROM pg_catalog.pg_default_acl d LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace
 ORDER BY role_name,schema_name,d.defaclobjtype""",
    'Q7_extensions': """SELECT extname,extversion,n.nspname AS schema_name
 FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace
 ORDER BY extname""",
    'Q7_event_triggers': """SELECT evtname,evtevent,evtenabled,evttags,
 pg_catalog.pg_get_userbyid(evtowner) AS owner_name,
 evtfoid::regprocedure::text AS routine
 FROM pg_catalog.pg_event_trigger ORDER BY evtname""",
    'Q7_rules': """SELECT n.nspname AS schema_name,c.relname,r.rulename,
 pg_catalog.pg_get_ruledef(r.oid,false) AS definition
 FROM pg_catalog.pg_rewrite r JOIN pg_catalog.pg_class c ON c.oid=r.ev_class
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 ORDER BY n.nspname,c.relname,r.rulename""",
    'Q7_unexpected': """SELECT pg_catalog.pg_describe_object(d.classid,d.objid,d.objsubid) AS identity,
 d.deptype FROM pg_catalog.pg_depend d
 WHERE d.refclassid='pg_catalog.pg_namespace'::regclass
 AND d.refobjid IN (SELECT oid FROM pg_catalog.pg_namespace
 WHERE nspname !~ '^pg_' AND nspname<>'information_schema')
 ORDER BY identity,d.deptype""",
    # Conditional only: a future collector must first establish ledger relation identity,
    # ordinary-table kind, expected structure and permissions using Q2-Q4.
    'Q8_ledger_count': 'SELECT count(*) AS migration_record_count FROM public."_prisma_migrations"',
}


def collect_live(*_args, **_kwargs):
    """No execution callback is accepted or called, even with a claimed approval."""
    raise RuntimeError('LIVE_COLLECTION_DISABLED')
