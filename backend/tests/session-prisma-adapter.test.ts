/** Offline fake Prisma transaction only. No live client import or database connection. */
import {beforeEach,it,expect,vi} from 'vitest';
import type {Prisma,PrismaClient} from '@prisma/client';
vi.mock('../lib/discord-accounts',()=>({assertPublicAuthSchema:vi.fn(async()=>{})}));
import {assertPublicAuthSchema} from '../lib/discord-accounts';
import {prepareSessionTransaction,prepareSessionStore} from '../lib/session-prisma-adapter';
import {issueSession,validateSession,revokeSession,ABSOLUTE_MS} from '../lib/persistent-session';
import {persistentSessionsEnabled} from '../lib/session-runtime';
const ticket='a'.repeat(64),browser='b'.repeat(64);
beforeEach(()=>vi.clearAllMocks());
function fixture(){
 let now=1000000;
 const account={id:'u',authGeneration:'4',status:'ACTIVE',role:'ADMIN',publicNmdId:'NMD-1',email:'synthetic@example.invalid',passwordHash:'private',discordEligible:true};
 const grant={tokenHash:ticket,userId:'u',authGeneration:'4' as string|null,provider:'DISCORD',browserHash:browser,createdAt:new Date(now-100),expiresAt:new Date(now+1000),consumedAt:null as Date|null};
 const identity={verifiedAt:new Date(1),revokedAt:null as Date|null,administrativeHoldAt:null as Date|null,revocationKind:null};
 let session:any=null;
 const events:string[]=[];
 const query=vi.fn(async(strings:TemplateStringsArray,..._values:unknown[])=>{
  const sql=strings.join('?');events.push(sql);
  if(sql.includes('set_config'))return [];
  if(sql.includes('FROM public."User"'))return [{...account}];
  if(sql.includes('AS now'))return [{now:new Date(now)}];
  if(sql.includes('FROM public."AuthSession"'))return session?[{...session}]:[];
  if(sql.includes('FROM public."IdentityLoginGrant"'))return [{...grant}];
  if(sql.includes('FROM public."ExternalIdentity"'))return [{...identity}];
  throw Error('UNEXPECTED_QUERY');
 });
 const execute=vi.fn(async(strings:TemplateStringsArray,...values:unknown[])=>{
  const sql=strings.join('?');events.push(sql);
  if(sql.includes('INSERT INTO public."AuthSession"')){
   session={idHash:values[0],userId:values[1],authGeneration:String(values[2]),method:values[3],authenticatedAt:values[5],expiresAt:values[6],revokedAt:null};return 1;
  }
  if(sql.includes('UPDATE public."IdentityLoginGrant"')){
   if(grant.consumedAt||grant.expiresAt.getTime()<=now)return 0;grant.consumedAt=new Date(now);return 1;
  }
  if(sql.includes('UPDATE public."AuthSession"')){if(!session||session.revokedAt)return 0;session.revokedAt=values[0];return 1;}
  throw Error('UNEXPECTED_WRITE');
 });
 const audit=vi.fn(async()=>({}));
 const tx={$queryRaw:query,$executeRaw:execute,auditEvent:{create:audit}} as unknown as Prisma.TransactionClient;
 const transaction=vi.fn(async(fn:(tx:Prisma.TransactionClient)=>Promise<unknown>,_options?:unknown)=>{
  const oldSession=session?{...session}:null,oldConsumed=grant.consumedAt;
  try{return await fn(tx);}catch(e){session=oldSession;grant.consumedAt=oldConsumed;throw e;}
 });
 const store=prepareSessionStore({$transaction:transaction} as unknown as Pick<PrismaClient,'$transaction'>);
 return {account,grant,identity,query,execute,audit,events,tx,transaction,store,getSession:()=>session,setNow:(n:number)=>{now=n;}};
}
const discord={userId:'u',expectedGeneration:'4',method:'DISCORD' as const,ticketHash:ticket,browserHash:browser};
it('prepares bounded transactions and schema guard before account locks, never enables runtime',async()=>{
 const f=fixture();const c=await f.store.transaction(tx=>issueSession(tx,discord));
 expect(persistentSessionsEnabled()).toBe(false);expect(assertPublicAuthSchema).toHaveBeenCalledWith(f.tx);
 expect(f.transaction.mock.calls[0][1]).toEqual({maxWait:2000,timeout:10000,isolationLevel:'ReadCommitted'});
 expect(f.events[0]).toContain('lock_timeout');expect(f.events[0]).toContain('statement_timeout');
 const user=f.events.findIndex(s=>s.includes('FROM public."User"')),grant=f.events.findIndex(s=>s.includes('FROM public."IdentityLoginGrant"')),identity=f.events.findIndex(s=>s.includes('SELECT "verifiedAt"'));
 expect(user).toBeLessThan(grant);expect(grant).toBeLessThan(identity);
 expect(f.getSession().idHash).not.toBe(c.secret);expect(JSON.stringify(f.getSession())).not.toContain(c.secret);
 expect(f.audit).toHaveBeenCalledWith({data:{actorId:'u',action:'SESSION_ISSUED',entityType:'User',entityId:'u',metadata:undefined}});
});
it('validates ownership and performs durable revocation in User-before-Session order',async()=>{
 const f=fixture();const c=await f.store.transaction(tx=>issueSession(tx,discord));
 expect((await validateSession(f.store,c)).status).toBe('VALID');
 f.events.length=0;expect(await revokeSession(f.store,c)).toBe('REVOKED');
 expect(f.events.findIndex(s=>s.includes('FROM public."User"'))).toBeLessThan(f.events.findIndex(s=>s.includes('FROM public."AuthSession"')));
 expect(await revokeSession(f.store,c)).toBe('ALREADY_REVOKED');expect((await validateSession(f.store,c)).status).toBe('INVALID');
});
it('legacy password issuance preserves role and generation without touching grants',async()=>{
 const f=fixture();const c=await f.store.transaction(tx=>issueSession(tx,{userId:'u',expectedGeneration:'4',method:'LEGACY_PASSWORD',verifiedPasswordHash:'private'}));
 expect(c.method).toBe('LEGACY_PASSWORD');expect(f.account.role).toBe('ADMIN');expect(f.getSession().authGeneration).toBe('4');
 expect(f.events.some(s=>s.includes('IdentityLoginGrant'))).toBe(false);
});
for(const change of [{authGeneration:null},{createdAt:null},{authGeneration:'3'},{consumedAt:new Date(1)},{provider:'STEAM'},{browserHash:'c'.repeat(64)},{expiresAt:new Date(1000000)}])it('rejects legacy, replayed, stale or invalid grant '+JSON.stringify(change),async()=>{
 const f=fixture();Object.assign(f.grant,change);await expect(f.store.transaction(tx=>issueSession(tx,discord))).rejects.toThrow();expect(f.getSession()).toBeNull();expect(f.execute).not.toHaveBeenCalled();
});
it('fresh DB time after grant-lock wait rejects expiry before any write',async()=>{
 const f=fixture(),original=f.query.getMockImplementation()!;
 f.query.mockImplementation(async(strings,...values)=>{const rows=await original(strings,...values);if(strings.join('').includes('FROM public."IdentityLoginGrant"'))f.setNow(1002000);return rows;});
 await expect(f.store.transaction(tx=>issueSession(tx,discord))).rejects.toThrow('LOGIN_GRANT_REJECTED');expect(f.execute).not.toHaveBeenCalled();
});
it('consumption SQL rechecks DB expiry after identity-lock wait',async()=>{
 const f=fixture(),original=f.query.getMockImplementation()!;
 f.query.mockImplementation(async(strings,...values)=>{const rows=await original(strings,...values);if(strings.join('').includes('SELECT "verifiedAt"'))f.setNow(1002000);return rows;});
 await expect(f.store.transaction(tx=>issueSession(tx,discord))).rejects.toThrow('LOGIN_GRANT_REJECTED');expect(f.getSession()).toBeNull();
 const sql=f.execute.mock.calls[0][0].join('?');expect(sql).toContain('clock_timestamp()');expect(sql).toContain('"expiresAt">instant.at');expect(sql).toContain('"consumedAt" IS NULL');expect(sql).toContain('"authGeneration"=');
});
for(const change of [{revokedAt:new Date(1)},{administrativeHoldAt:new Date(1)}])it('rejects identity restriction at grant consumption',async()=>{
 const f=fixture();Object.assign(f.identity,change);await expect(f.store.transaction(tx=>issueSession(tx,discord))).rejects.toThrow();expect(f.execute).not.toHaveBeenCalled();
});
it('schema failures stop before account allocation or writes',async()=>{
 const f=fixture();vi.mocked(assertPublicAuthSchema).mockRejectedValueOnce(Error('UNSUPPORTED_AUTH_SCHEMA'));
 await expect(f.store.transaction(tx=>issueSession(tx,discord))).rejects.toThrow('UNSUPPORTED_AUTH_SCHEMA');expect(f.events).toHaveLength(1);expect(f.execute).not.toHaveBeenCalled();
});
it('rejects session/grant locks before User and reverse lock order',async()=>{
 const f=fixture(),tx=await prepareSessionTransaction(f.tx);
 await expect(tx.lockSession(ticket)).rejects.toThrow();await expect(tx.lockDiscordGrant(ticket)).rejects.toThrow();
 await tx.lockAccount('u');await tx.lockDiscordGrant(ticket);await expect(tx.lockAccount('u')).rejects.toThrow();await expect(tx.lockSession(ticket)).rejects.toThrow();
});
it('rejects wrong-owner session returned by a faulty adapter boundary',async()=>{
 const f=fixture();const c=await f.store.transaction(tx=>issueSession(tx,discord));f.getSession().userId='other';expect((await validateSession(f.store,c)).status).toBe('UNAVAILABLE');
});
it('audit failure propagates and fake transaction rolls back session and grant together',async()=>{
 const f=fixture();f.audit.mockRejectedValueOnce(Error('audit'));await expect(f.store.transaction(tx=>issueSession(tx,discord))).rejects.toThrow('audit');expect(f.getSession()).toBeNull();expect(f.grant.consumedAt).toBeNull();expect(f.transaction).toHaveBeenCalledOnce();
});
it('insert failure aborts without retry',async()=>{
 const f=fixture(),original=f.execute.getMockImplementation()!;
 f.execute.mockImplementation(async(strings,...values)=>{if(strings.join('').includes('INSERT INTO public."AuthSession"'))throw Error('unique conflict');return original(strings,...values);});
 await expect(f.store.transaction(tx=>issueSession(tx,discord))).rejects.toThrow('unique conflict');expect(f.transaction).toHaveBeenCalledOnce();expect(f.getSession()).toBeNull();expect(f.grant.consumedAt).toBeNull();
});
it('uncertain commit stays unconfirmed and never retries revocation',async()=>{
 const f=fixture();const c=await f.store.transaction(tx=>issueSession(tx,discord));const original=f.transaction.getMockImplementation()!;
 f.transaction.mockImplementationOnce(async(fn,options)=>{await original(fn,options);throw Error('uncertain commit');});
 const before=f.transaction.mock.calls.length;expect(await revokeSession(f.store,c)).toBe('UNCONFIRMED');expect(f.transaction.mock.calls.length-before).toBe(1);
});
it('uses fixed parameterized relations even for malicious identifier input',async()=>{
 const f=fixture(),tx=await prepareSessionTransaction(f.tx);await expect(tx.lockAccount('u"; DROP TABLE x;--')).rejects.toThrow();
 const call=f.query.mock.calls.at(-1)!;expect(call[0].join('')).not.toContain('DROP TABLE');expect(call[1]).toContain('DROP TABLE');expect(f.execute).not.toHaveBeenCalled();
});

for(const change of [{authGeneration:'5'},{status:'SUSPENDED'},{status:'UNDER_REVIEW'},{status:'BADGE_REVOKED'}])it('account rotation/restriction prevents issuance '+JSON.stringify(change),async()=>{
 const f=fixture();Object.assign(f.account,change);await expect(f.store.transaction(tx=>issueSession(tx,discord))).rejects.toThrow();expect(f.execute).not.toHaveBeenCalled();
});
it('claim requires post-lock now and rejects a pre-lock timestamp',async()=>{
 const f=fixture(),tx=await prepareSessionTransaction(f.tx);await tx.lockAccount('u');const pre=await tx.now();await tx.lockDiscordGrant(ticket);
 await expect(tx.claimDiscordGrant({...discord,userId:'u',generation:'4',now:pre})).rejects.toThrow('SESSION_ADAPTER_REJECTED');expect(f.execute).not.toHaveBeenCalled();
});
it('wrong generation or owner cannot be inserted through the adapter',async()=>{
 const f=fixture(),tx=await prepareSessionTransaction(f.tx);await tx.lockAccount('u');const now=await tx.now();
 for(const change of [{generation:'5'},{userId:'other'}])await expect(tx.insertSession({idHash:ticket,userId:'u',generation:'4',method:'LEGACY_PASSWORD',authenticatedAt:now,expiresAt:now+ABSOLUTE_MS,revokedAt:null,...change})).rejects.toThrow();
 expect(f.execute).not.toHaveBeenCalled();
});
