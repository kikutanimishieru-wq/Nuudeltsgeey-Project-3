/** Prepared, UNWIRED adapter. Never imports a live Prisma client or enables a gate.
 * All SQL is fixed to public and parameterized through Prisma's supported API.
 */
import type {Prisma,PrismaClient} from '@prisma/client';
import {assertPublicAuthSchema} from './discord-accounts';
import {writeAudit} from './audit';
import {hasAdministrativeHold} from './identity-policy';
import {ABSOLUTE_MS,validGeneration,type Account,type SessionStore,type SessionTransaction,type SessionRow,type LockedDiscordGrant} from './persistent-session';

const reject=():never=>{throw Error('SESSION_ADAPTER_REJECTED');};
const hash=(v:string)=>/^[a-f0-9]{64}$/.test(v);
function time(v:Date):number {if(!(v instanceof Date)||!Number.isSafeInteger(v.getTime()))return reject();return v.getTime();}
function generation(v:unknown):string {if(typeof v!=='string'||!validGeneration(v))return reject();return v;}
type StoredSession={idHash:string;userId:string;authGeneration:string;method:SessionRow['method'];authenticatedAt:Date;expiresAt:Date;revokedAt:Date|null};
type StoredGrant={tokenHash:string;userId:string;authGeneration:string|null;provider:string;browserHash:string;createdAt:Date|null;expiresAt:Date;consumedAt:Date|null};

/** Caller owns a bounded transaction; no methods start/commit/retry transactions.
 * Only one account per adapter. Existing User locks may be reacquired before C/S.
 */
export async function prepareSessionTransaction(tx:Prisma.TransactionClient):Promise<SessionTransaction>{
  await tx.$queryRaw`SELECT set_config('lock_timeout','2000ms',true), set_config('statement_timeout','5000ms',true), set_config('TimeZone','UTC',true)`;
  await assertPublicAuthSchema(tx);
  let owner:string|undefined, ownerGeneration:string|undefined, laterLock=false;
  let lockedSession:SessionRow|null=null, grant:LockedDiscordGrant|null=null;
  let freshTime:number|undefined;
  const requireOwner=()=>{if(!owner)reject();return owner!;};
  const api:SessionTransaction={
    async lockAccount(id){
      if(!id || owner && owner!==id || laterLock) return reject();
      const rows=await tx.$queryRaw<Array<Omit<Account,'generation'|'discordEligible'>&{authGeneration:string;discordEligible:boolean}>>`
        SELECT u."id", u."authGeneration"::text AS "authGeneration", u."accountStatus" AS status,
          u.role, u."publicNmdId", u.email, u."passwordHash",
          EXISTS(SELECT 1 FROM public."ExternalIdentity" i WHERE i."userId"=u.id AND i.provider='DISCORD'
            AND i."verifiedAt" IS NOT NULL AND i."revokedAt" IS NULL AND i."administrativeHoldAt" IS NULL) AS "discordEligible"
        FROM public."User" u WHERE u.id=${id} FOR UPDATE OF u`;
      if(rows.length===0)return null;
      if(rows.length!==1 || rows[0].id!==id || typeof rows[0].discordEligible!=='boolean')return reject();
      owner=id;const {authGeneration,...a}=rows[0];ownerGeneration=generation(authGeneration);return {...a,generation:ownerGeneration};
    },
    async lockSession(idHash){
      const userId=requireOwner();if(!hash(idHash)||laterLock)return reject();laterLock=true;
      const rows=await tx.$queryRaw<StoredSession[]>`SELECT "idHash","userId","authGeneration"::text AS "authGeneration",method,"authenticatedAt","expiresAt","revokedAt"
        FROM public."AuthSession" WHERE "idHash"=${idHash} AND "userId"=${userId} FOR UPDATE`;
      if(rows.length===0){lockedSession=null;return null;}
      if(rows.length!==1)return reject();const r=rows[0];
      if(r.idHash!==idHash||r.userId!==userId||!['DISCORD','LEGACY_PASSWORD'].includes(r.method))return reject();
      lockedSession={idHash:r.idHash,userId:r.userId,generation:generation(r.authGeneration),method:r.method,authenticatedAt:time(r.authenticatedAt),expiresAt:time(r.expiresAt),revokedAt:r.revokedAt===null?null:time(r.revokedAt)};
      return {...lockedSession};
    },
    async now(){
      requireOwner();const rows=await tx.$queryRaw<Array<{now:Date}>>`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`;
      if(rows.length!==1)return reject();freshTime=time(rows[0].now);return freshTime;
    },
    async lockDiscordGrant(ticketHash){
      const userId=requireOwner();if(!hash(ticketHash)||lockedSession||laterLock)return reject();laterLock=true;freshTime=undefined;
      const rows=await tx.$queryRaw<StoredGrant[]>`SELECT "tokenHash","userId","authGeneration"::text AS "authGeneration",provider,"browserHash","createdAt","expiresAt","consumedAt"
        FROM public."IdentityLoginGrant" WHERE "tokenHash"=${ticketHash} AND "userId"=${userId} FOR UPDATE`;
      if(rows.length===0)return null;if(rows.length!==1)return reject();const r=rows[0];
      // Historical/unversioned grants never mint persistent authority.
      if(r.authGeneration===null||r.createdAt===null)return null;
      const created=time(r.createdAt),expires=time(r.expiresAt);
      if(r.tokenHash!==ticketHash||r.userId!==userId||!hash(r.browserHash)||r.provider!=='DISCORD'||expires<=created||expires>created+60000)return reject();
      grant={ticketHash:r.tokenHash,userId:r.userId,generation:generation(r.authGeneration),browserHash:r.browserHash,provider:r.provider,expiresAt:expires,consumedAt:r.consumedAt===null?null:time(r.consumedAt)};
      return {...grant};
    },
    async claimDiscordGrant(input){
      const userId=requireOwner();
      if(!grant || freshTime===undefined || input.now!==freshTime || input.userId!==userId || input.ticketHash!==grant.ticketHash
        || input.browserHash!==grant.browserHash || input.generation!==grant.generation || grant.consumedAt!==null || grant.expiresAt<=input.now)return reject();
      const identities=await tx.$queryRaw<Array<{verifiedAt:Date;revokedAt:Date|null;administrativeHoldAt:Date|null;revocationKind:string|null}>>`
        SELECT "verifiedAt","revokedAt","administrativeHoldAt","revocationKind" FROM public."ExternalIdentity"
        WHERE "userId"=${userId} AND provider='DISCORD' FOR UPDATE`;
      if(identities.length!==1||!identities[0].verifiedAt||identities[0].revokedAt||hasAdministrativeHold(identities[0]))return false;
      // Recheck the actual DB clock after any identity-lock wait, in the consumption statement.
      const count=await tx.$executeRaw`WITH instant AS MATERIALIZED (SELECT date_trunc('milliseconds',clock_timestamp()) AS at)
        UPDATE public."IdentityLoginGrant" SET "consumedAt"=instant.at FROM instant
        WHERE "tokenHash"=${input.ticketHash} AND "userId"=${userId} AND provider='DISCORD'
          AND "browserHash"=${input.browserHash} AND "authGeneration"=${BigInt(input.generation)}
          AND "consumedAt" IS NULL AND "createdAt" IS NOT NULL AND "createdAt"<=instant.at
          AND "expiresAt">instant.at AND "expiresAt">${new Date(input.now)}`;
      if(count!==0&&count!==1)return reject();if(count===1)grant.consumedAt=input.now;return count===1;
    },
    async insertSession(r){
      const userId=requireOwner();
      if(r.userId!==userId||r.generation!==ownerGeneration||r.authenticatedAt!==freshTime
        ||r.method==='DISCORD'&&(!grant||grant.consumedAt===null)||!hash(r.idHash)||!validGeneration(r.generation)||!['DISCORD','LEGACY_PASSWORD'].includes(r.method)
        ||r.revokedAt!==null||!Number.isSafeInteger(r.authenticatedAt)||r.authenticatedAt<0||r.expiresAt-r.authenticatedAt!==ABSOLUTE_MS)return reject();
      const count=await tx.$executeRaw`INSERT INTO public."AuthSession" ("idHash","userId","authGeneration",method,"createdAt","authenticatedAt","expiresAt","revokedAt")
        VALUES (${r.idHash},${userId},${BigInt(r.generation)},${r.method}::public."SessionAuthenticationMethod",${new Date(r.authenticatedAt)},${new Date(r.authenticatedAt)},${new Date(r.expiresAt)},NULL)`;
      if(count!==1)return reject();
    },
    async revokeSession(idHash,at){
      const userId=requireOwner();if(!lockedSession||lockedSession.idHash!==idHash||lockedSession.revokedAt!==null||!Number.isSafeInteger(at)||at<lockedSession.authenticatedAt)return reject();
      const count=await tx.$executeRaw`UPDATE public."AuthSession" SET "revokedAt"=${new Date(at)}
        WHERE "idHash"=${idHash} AND "userId"=${userId} AND "revokedAt" IS NULL`;
      if(count!==0&&count!==1)return reject();if(count===1)lockedSession.revokedAt=at;return count===1;
    },
    async audit(event){
      if(event.userId!==requireOwner()||!['SESSION_ISSUED','SESSION_REVOKED'].includes(event.action))return reject();
      await writeAudit(tx,{actorId:event.userId,action:event.action,entityType:'User',entityId:event.userId});
    },
  };
  return api;
}

/** Explicit injected client only; intentionally not wired into session-runtime.ts.
 * Prisma owns commit/rollback. All errors, including uncertain commit, propagate.
 */
export function prepareSessionStore(client:Pick<PrismaClient,'$transaction'>):SessionStore{
  return {transaction:fn=>client.$transaction(async tx=>fn(await prepareSessionTransaction(tx)),{maxWait:2000,timeout:10000,isolationLevel:'ReadCommitted'})};
}
