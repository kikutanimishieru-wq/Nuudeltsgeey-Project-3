// Internal helper: reference schemas use disposable memory only; remote SQL is read-only.
const fs = require('node:fs');
const path = require('node:path');
const metadataSql = `SELECT jsonb_build_object(
 'columns',(SELECT jsonb_agg(jsonb_build_array(c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind='r' AND c.relname<>'_prisma_migrations' AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(jsonb_build_array(c.relname,x.conname,pg_get_constraintdef(x.oid),x.convalidated,x.condeferrable,x.condeferred) ORDER BY c.relname,x.conname) FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname<>'_prisma_migrations' AND x.contype<>'n'),
 'indexes',(SELECT jsonb_agg(jsonb_build_array(c.relname,i.relname,pg_get_indexdef(i.oid),x.indisvalid,x.indisready) ORDER BY i.relname) FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname<>'_prisma_migrations'),
 'enums',(SELECT jsonb_agg(jsonb_build_array(t.typname,e.enumlabel) ORDER BY t.typname,e.enumsortorder) FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(c.relname,t.tgname,pg_get_triggerdef(t.oid),t.tgenabled) ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal),
 'functions',(SELECT jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid)) ORDER BY p.proname,p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
,'security',jsonb_build_object(
 'relations',(SELECT jsonb_agg(jsonb_build_array(c.relname,c.relkind,pg_get_userbyid(c.relowner)=current_user,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname<>'_prisma_migrations'),
 'table_acl',(SELECT jsonb_agg(jsonb_build_array(c.relname,CASE WHEN a.grantee=c.relowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable) ORDER BY c.relname,a.privilege_type,a.grantee) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') AND c.relname<>'_prisma_migrations'),
 'policies',(SELECT jsonb_agg(jsonb_build_array(tablename,policyname,permissive,roles,cmd,qual,with_check) ORDER BY tablename,policyname) FROM pg_policies WHERE schemaname='public'),
 'views',(SELECT jsonb_agg(jsonb_build_array(c.relname,c.relkind,pg_get_viewdef(c.oid)) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m')),
 'function_acl',(SELECT jsonb_agg(jsonb_build_array(p.proname,pg_get_userbyid(p.proowner)=current_user,CASE WHEN a.grantee=p.proowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable) ORDER BY p.proname,a.privilege_type,a.grantee) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='public'),
 'column_acl',(SELECT jsonb_agg(jsonb_build_array(c.relname,at.attname,CASE WHEN a.grantee=c.relowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable) ORDER BY c.relname,at.attnum,a.privilege_type,a.grantee) FROM pg_attribute at JOIN pg_class c ON c.oid=at.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(at.attacl) a WHERE n.nspname='public' AND c.relname<>'_prisma_migrations'),
 'schema_acl',(SELECT jsonb_agg(jsonb_build_array(pg_get_userbyid(n.nspowner) IN (current_user,'pg_database_owner'),CASE WHEN a.grantee=n.nspowner OR pg_get_userbyid(a.grantee)='pg_database_owner' THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable) ORDER BY a.privilege_type,a.grantee) FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='public'),
 'other_schemas',(SELECT jsonb_agg(nspname ORDER BY nspname) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('public','information_schema')),
 'other_types',(SELECT jsonb_agg(jsonb_build_array(t.typname,t.typtype) ORDER BY t.typname) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype IN ('d','r','m'))
 )) AS metadata`;

async function main() {
 const mode = process.argv[2];
 if(mode === 'reference') {
  const {PGlite} = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
   const root = process.argv[3];
   const migrations = fs.readdirSync(root).filter(n=>/^\d{14}_/.test(n)).sort();
   let foundation;
   for(const [i,name] of migrations.entries()) {
    await db.exec(fs.readFileSync(path.join(root,name,'migration.sql'),'utf8'));
    if(i===0) foundation=(await db.query(metadataSql)).rows[0].metadata;
   }
   console.log(JSON.stringify({foundation,final:(await db.query(metadataSql)).rows[0].metadata}));
  } finally {await db.close();}
 } else if(mode === 'remote') {
  if(!process.env.PHASE4_VALIDATION_DATABASE_URL) throw Error();
  const {PrismaClient}=require('@prisma/client');
  const db=new PrismaClient({datasources:{db:{url:process.env.PHASE4_VALIDATION_DATABASE_URL}},log:[]});
  try {
   const result=await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '20s'");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
    const [timeouts]=await tx.$queryRawUnsafe("SELECT current_setting('idle_in_transaction_session_timeout') AS idle");
    if(timeouts.idle!=='1min') throw Error();
    const [identity]=await tx.$queryRawUnsafe('SELECT current_database() AS database, current_user AS role');
    if(identity.database!=='neondb'||identity.role!=='neondb_owner') throw Error();
    const ledger=await tx.$queryRawUnsafe('SELECT migration_name,checksum,finished_at,rolled_back_at FROM public."_prisma_migrations" ORDER BY migration_name');
    const [row]=await tx.$queryRawUnsafe(metadataSql);
    return {ledger,metadata:row.metadata};
   },{timeout:30000});
   console.log(JSON.stringify(result));
  } finally {await db.$disconnect();}
 } else throw Error();
}
if(require.main===module) main().catch(()=>{console.error('Schema verification failed; diagnostics suppressed.');process.exitCode=1;});
module.exports={metadataSql};
