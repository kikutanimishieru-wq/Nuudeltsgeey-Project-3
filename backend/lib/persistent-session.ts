/** Server-side core. Persistence is an explicit transactional dependency, never a Map. */
import { createHash, randomBytes } from 'node:crypto';
export const ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export type Method = 'DISCORD' | 'LEGACY_PASSWORD';
export type Claims = Readonly<{ version: 1; userId: string; secret: string; generation: string; method: Method; authenticatedAt: number; expiresAt: number }>;
export type Account = { id: string; generation: string; status: string; role: string; publicNmdId: string; email: string | null; passwordHash?: string | null; discordEligible: boolean };
export type SessionRow = { idHash: string; userId: string; generation: string; method: Method; authenticatedAt: number; expiresAt: number; revokedAt: number | null };
export type LockedDiscordGrant = {ticketHash:string;browserHash:string;userId:string;generation:string;provider:string;expiresAt:number;consumedAt:number|null};
export interface SessionTransaction {
  /** Calls reserve User before Session/grant; adapter must enforce bounded SQL locks. */
  lockAccount(id: string): Promise<Account | null>;
  lockSession(hash: string): Promise<SessionRow | null>;
  now(): Promise<number>;
  insertSession(row: SessionRow): Promise<void>;
  revokeSession(hash: string, at: number): Promise<boolean>;
  /** Lock the grant AFTER User; hold through conditional consumption and commit. */
  lockDiscordGrant(ticketHash:string):Promise<LockedDiscordGrant|null>;
  /** Consume the already locked grant exactly once, rechecking bindings and expiry
   * against the fresh post-lock DB timestamp supplied here. Never acquire a new lock. */
  claimDiscordGrant(input: { ticketHash: string; browserHash: string; userId: string; generation: string; now: number }): Promise<boolean>;
  audit(event: { action: string; userId: string }): Promise<void>;
}
export interface SessionStore { transaction<T>(fn: (tx: SessionTransaction) => Promise<T>): Promise<T> }
export const hashSecret = (value: string) => createHash('sha256').update(value).digest('hex');
export function validGeneration(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= BigInt('9223372036854775807');
}
export function parseClaims(value: unknown): Claims | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Claims;
  if (Object.keys(c).sort().join(',') !== 'authenticatedAt,expiresAt,generation,method,secret,userId,version'
    || c.version !== 1 || typeof c.userId !== 'string' || !c.userId || c.userId.length > 128
    || typeof c.secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(c.secret) || !validGeneration(c.generation)
    || !['DISCORD','LEGACY_PASSWORD'].includes(c.method)
    || !Number.isSafeInteger(c.authenticatedAt) || !Number.isSafeInteger(c.expiresAt)
    || c.authenticatedAt < 0 || c.expiresAt - c.authenticatedAt !== ABSOLUTE_MS) return null;
  return Object.freeze({...c});
}
const permitted = (a: Account) => ['CREATED','UNVERIFIED','VERIFIED','ACTIVE'].includes(a.status);
export type Validation = { status: 'VALID'; claims: Claims; account: Omit<Account,'passwordHash'> } | { status: 'INVALID' | 'EXPIRED' | 'UNAVAILABLE' };
function matches(a: Account, r: SessionRow, c: Claims) {
  return a.id === c.userId && a.generation === c.generation && permitted(a)
    && r.idHash === hashSecret(c.secret) && r.userId === c.userId && r.generation === c.generation
    && r.method === c.method && r.authenticatedAt === c.authenticatedAt && r.expiresAt === c.expiresAt
    && r.revokedAt === null && (c.method !== 'DISCORD' || a.discordEligible === true);
}
export async function validateSession(store: SessionStore, input: unknown, linking = false): Promise<Validation> {
  const c = parseClaims(input); if (!c) return { status: 'INVALID' };
  try {
    return await store.transaction(async tx => {
      const a = await tx.lockAccount(c.userId); const r = await tx.lockSession(hashSecret(c.secret)); const now = await tx.now();
      if (!Number.isSafeInteger(now)) return { status: 'UNAVAILABLE' };
      if (now >= c.expiresAt) return { status: 'EXPIRED' };
      if (!a || !r || now < c.authenticatedAt || !matches(a,r,c) || linking && c.method !== 'DISCORD') return { status: 'INVALID' };
      const { passwordHash: _private, ...safe } = a;
      return { status: 'VALID', claims: c, account: safe };
    });
  } catch { return { status: 'UNAVAILABLE' }; }
}
export type IssueInput = { userId: string; expectedGeneration: string } & (
  { method: 'LEGACY_PASSWORD'; verifiedPasswordHash: string } |
  { method: 'DISCORD'; ticketHash: string; browserHash: string }
);
/** Accepts ONLY backend verification material. Never expose this as a public request body. */
export async function issueSession(tx: SessionTransaction, input: IssueInput): Promise<Claims> {
  const a = await tx.lockAccount(input.userId); let now = await tx.now();
  if (!a || a.id !== input.userId || !permitted(a) || !validGeneration(a.generation)
    || a.generation !== input.expectedGeneration || !Number.isSafeInteger(now)) throw Error('SESSION_ISSUANCE_REJECTED');
  if (input.method === 'LEGACY_PASSWORD') {
    if (!input.verifiedPasswordHash || !a.passwordHash || a.passwordHash !== input.verifiedPasswordHash) throw Error('CREDENTIAL_CHANGED');
  } else if (input.method === 'DISCORD') {
    if (a.discordEligible!==true || !/^[a-f0-9]{64}$/.test(input.ticketHash) || !/^[a-f0-9]{64}$/.test(input.browserHash)) throw Error('LOGIN_GRANT_REJECTED');
    const grant=await tx.lockDiscordGrant(input.ticketHash);
    now=await tx.now(); // Fresh DB clock AFTER any grant-lock wait; no pre-lock expiry authority.
    if (!grant || !Number.isSafeInteger(now) || !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt<=now
      || grant.ticketHash!==input.ticketHash || grant.browserHash!==input.browserHash || grant.userId!==a.id
      || grant.generation!==a.generation || grant.provider!=='DISCORD' || grant.consumedAt!==null
      || await tx.claimDiscordGrant({ticketHash:input.ticketHash,browserHash:input.browserHash,userId:a.id,generation:a.generation,now}) !== true) throw Error('LOGIN_GRANT_REJECTED');
  } else { throw Error('SESSION_METHOD_REJECTED'); }
  const claims: Claims = {version:1,userId:a.id,secret:randomBytes(32).toString('base64url'),generation:a.generation,method:input.method,authenticatedAt:now,expiresAt:now+ABSOLUTE_MS};
  if (!parseClaims(claims)) throw Error('SESSION_TIME_INVALID');
  await tx.insertSession({idHash:hashSecret(claims.secret),userId:a.id,generation:a.generation,method:claims.method,authenticatedAt:now,expiresAt:claims.expiresAt,revokedAt:null});
  await tx.audit({action:'SESSION_ISSUED',userId:a.id});
  return claims;
}
export type Revocation = 'REVOKED' | 'ALREADY_REVOKED' | 'EXPIRED' | 'INVALID' | 'UNCONFIRMED';
export async function revokeSession(store: SessionStore, input: unknown): Promise<Revocation> {
  const c = parseClaims(input); if (!c) return 'INVALID';
  try {
    return await store.transaction(async tx => {
      const a = await tx.lockAccount(c.userId); const r = await tx.lockSession(hashSecret(c.secret)); const now = await tx.now();
      // Revocation must work even after account restriction or generation advancement.
      if (!a || !r || r.idHash !== hashSecret(c.secret) || a.id !== c.userId || r.userId !== c.userId || r.generation !== c.generation
        || r.method !== c.method || r.authenticatedAt !== c.authenticatedAt || r.expiresAt !== c.expiresAt || !Number.isSafeInteger(now)) return 'INVALID';
      if (r.revokedAt !== null) return 'ALREADY_REVOKED';
      if (now >= r.expiresAt) return 'EXPIRED';
      if (now < r.authenticatedAt || await tx.revokeSession(r.idHash,now) !== true) throw Error('REVOCATION_UNCONFIRMED');
      await tx.audit({action:'SESSION_REVOKED',userId:a.id}); return 'REVOKED';
    });
  } catch { return 'UNCONFIRMED'; }
}
export function publicSession(valid: Extract<Validation,{status:'VALID'}>, jwtExpSeconds: number) {
  if (!Number.isSafeInteger(jwtExpSeconds)) throw Error('INVALID_JWT_EXPIRY');
  return {user:{id:valid.account.id,role:valid.account.role,accountStatus:valid.account.status,publicNmdId:valid.account.publicNmdId,email:valid.account.email},
    expires:new Date(Math.min(valid.claims.expiresAt,jwtExpSeconds*1000)).toISOString()};
}
