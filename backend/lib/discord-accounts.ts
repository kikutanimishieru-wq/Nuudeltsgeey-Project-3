import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { hasAdministrativeHold } from './identity-policy';
import { SecurityError } from './security-error';
import { writeAudit } from './audit';

export function assertDiscordSignIn(provider: string) {
  if (provider !== 'DISCORD') throw new SecurityError('DISCORD_SIGN_IN_REQUIRED', 403);
}
export function assertSignInAccount(status: string) {
  if (!['CREATED', 'UNVERIFIED', 'VERIFIED', 'ACTIVE'].includes(status)) throw new SecurityError('ACCOUNT_RESTRICTED', 403);
}

/** Caller owns the transaction and current User row lock. Never clears restrictions. */
export async function refreshCompetitiveStatus(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM public."User" WHERE "id" = ${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, accountStatus: true, externalIdentities: true } });
  if (!user || user.role !== 'PLAYER' || !['CREATED','UNVERIFIED','VERIFIED'].includes(user.accountStatus)) return;
  if (user.externalIdentities.some(link => link.revokedAt || hasAdministrativeHold(link))) return;
  if (!['DISCORD','STEAM'].every(provider => user.externalIdentities.some(link => link.provider === provider && link.verifiedAt))) return;
  const changed = await tx.user.updateMany({ where: { id: userId, role: 'PLAYER', accountStatus: user.accountStatus }, data: { accountStatus: 'ACTIVE' } });
  if (changed.count !== 1) throw new SecurityError('ACCOUNT_CHANGED',409);
  await writeAudit(tx,{ actorId:userId, action:'COMPETITIVE_IDENTITY_ACTIVATED',entityType:'User',entityId:userId });
}

/** Fixed public schema only. Validate connection configuration AND the effective
 * SQL namespace; a valid public catalog alone does not prove the active target.
 */
export async function assertPublicAuthSchema(tx: Prisma.TransactionClient) {
  let url: URL;
  try { url = new URL(process.env.DATABASE_URL ?? ''); } catch { throw new SecurityError('AUTH_SCHEMA_TARGET_REQUIRED',503); }
  const schemas = url.searchParams.getAll('schema');
  if (!['postgres:','postgresql:'].includes(url.protocol) || schemas.length > 1 || schemas.length === 1 && schemas[0] !== 'public') throw new SecurityError('UNSUPPORTED_AUTH_SCHEMA',503);
  const rows = await tx.$queryRaw<Array<{schema_name:string;safe_path:boolean;user_target:boolean}>>`
    SELECT current_schema() AS schema_name,
      current_schemas(true) = ARRAY['pg_catalog','public']::name[] AS safe_path,
      to_regclass('"User"') = to_regclass('public."User"') AS user_target`;
  if (rows.length !== 1 || rows[0].schema_name !== 'public' || rows[0].safe_path !== true || rows[0].user_target !== true) throw new SecurityError('UNSUPPORTED_AUTH_SCHEMA',503);
}

/** Verified provider subject only. No display name/email matching, merge or retries.
 * Advisory lock serializes this provisioning path before identity lookup. Database
 * uniqueness remains the backstop against other identity-writing paths.
 */
export async function resolveDiscordAccount(tx: Prisma.TransactionClient, subject: string) {
  if (!/^\d{17,20}$/.test(subject)) throw new SecurityError('INVALID_PROVIDER_RESPONSE',400);
  await assertPublicAuthSchema(tx);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`nuudeltsgeey:discord:${subject}`}, 0))`;
  const link = await tx.externalIdentity.findUnique({ where: { provider_providerAccountId: { provider:'DISCORD',providerAccountId:subject } } });
  if (link) {
    await tx.$queryRaw`SELECT "id" FROM public."User" WHERE "id" = ${link.userId} FOR UPDATE`;
    const current = await tx.externalIdentity.findUnique({ where: { userId_provider:{ userId:link.userId,provider:'DISCORD' } } });
    if (!current || current.providerAccountId !== subject || current.revokedAt || hasAdministrativeHold(current)) throw new SecurityError('IDENTITY_REQUIRES_REVIEW',403);
    const user = await tx.user.findUnique({ where:{id:link.userId},select:{accountStatus:true,profile:{select:{id:true}}} });
    if (!user || !user.profile) throw new SecurityError('EXISTING_ACCOUNT_REQUIRES_REVIEW',409);
    assertSignInAccount(user.accountStatus);
    await refreshCompetitiveStatus(tx,link.userId);
    return link.userId;
  }
  if (process.env.DISCORD_ACCOUNT_PROVISIONING_ENABLED !== '1') throw new SecurityError('DISCORD_PROVISIONING_NOT_ENABLED',503);
  // Runtime guard does not apply a migration. Reject incomplete/unexpected schema.
  const columns = await tx.$queryRaw<Array<{column_name:string;is_nullable:string;data_type:string}>>`
    SELECT column_name, is_nullable, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name IN ('email','passwordHash')`;
  if (columns.length !== 2 || !['email','passwordHash'].every(name => columns.filter(c=>c.column_name === name && c.is_nullable === 'YES' && c.data_type === 'text').length === 1)) throw new SecurityError('PASSWORDLESS_SCHEMA_REQUIRED',503);
  const sequence = await tx.identitySequence.upsert({where:{id:'public-nmd'},create:{id:'public-nmd',nextValue:2},update:{nextValue:{increment:1}}});
  const id = randomUUID();
  const nmd = `NMD-${String(sequence.nextValue-1).padStart(6,'0')}`;
  // Parameterized fixed insert permits NULL credentials without pretending the
  // existing generated Prisma client already reflects an unapplied schema change.
  await tx.$executeRaw`INSERT INTO public."User" ("id","email","passwordHash","role","accountStatus","publicNmdId","createdAt","updatedAt")
    VALUES (${id},NULL,NULL,'PLAYER','UNVERIFIED',${nmd},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`;
  await tx.playerProfile.create({data:{userId:id,nickname:`Player-${id.replace(/-/g,'').slice(0,25)}`,currentNr:1000}});
  await tx.externalIdentity.create({data:{userId:id,provider:'DISCORD',providerAccountId:subject,verifiedAt:new Date()}});
  await writeAudit(tx,{actorId:id,action:'DISCORD_ACCOUNT_CREATED',entityType:'User',entityId:id,metadata:{provider:'DISCORD'}});
  return id;
}
