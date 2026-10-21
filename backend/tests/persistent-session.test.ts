/** Fake transactional persistence only; no Prisma/client, listeners or provider imports. */
import {it,expect,vi} from 'vitest';
import {issueSession,validateSession,revokeSession,publicSession,hashSecret,ABSOLUTE_MS,parseClaims,type Claims,type SessionStore,type SessionTransaction,type Account,type SessionRow} from '../lib/persistent-session';
import {encodeAbsolute,boundCookies,decodedClaims} from '../lib/session-codec';
import {sessionBoundary} from '../lib/session-boundary';
function fixture(){
 const now=[1000000],events:string[]=[];
 const account:Account={id:'u',generation:'4',status:'ACTIVE',role:'ADMIN',publicNmdId:'NMD-000001',email:null,passwordHash:'private-hash',discordEligible:true};
 let row:SessionRow|null=null;
 const tx:SessionTransaction={lockAccount:vi.fn(async()=>{events.push('U');return account;}),lockSession:vi.fn(async()=>{events.push('S');return row;}),now:async()=>now[0],
  insertSession:vi.fn(async r=>{events.push('INSERT');row=r;}),revokeSession:vi.fn(async(_h,at)=>{events.push('REVOKE');row!.revokedAt=at;return true;}),lockDiscordGrant:vi.fn(async()=>{events.push('GRANT_LOCK');return {ticketHash:'a'.repeat(64),browserHash:'b'.repeat(64),userId:'u',generation:'4',provider:'DISCORD',expiresAt:now[0]+10000,consumedAt:null};}),claimDiscordGrant:vi.fn(async()=>{events.push('GRANT');return true;}),audit:vi.fn(async()=>{events.push('AUDIT');})};
 const store:SessionStore={transaction:vi.fn(async fn=>fn(tx))};
 const issue=()=>store.transaction(t=>issueSession(t,{userId:'u',expectedGeneration:'4',method:'LEGACY_PASSWORD',verifiedPasswordHash:'private-hash'}));
 return {now,account,tx,store,events,issue,getRow:()=>row};
}
it('issues cryptographic secrets, stores only hashes and preserves role/state',async()=>{
 const f=fixture(),c=await f.issue(),second=await f.issue();expect(c.secret).not.toBe(second.secret);expect(c.expiresAt-c.authenticatedAt).toBe(ABSOLUTE_MS);expect(c.generation).toBe('4');
 expect(f.getRow()?.idHash).toBe(hashSecret(second.secret));expect(JSON.stringify(f.getRow())).not.toContain(second.secret);expect(f.account.role).toBe('ADMIN');expect(f.events.slice(0,3)).toEqual(['U','INSERT','AUDIT']);
});
it('rejects credential/generation changes before insert',async()=>{
 for(const change of ['credential','generation']){const f=fixture();if(change==='credential')f.account.passwordHash='rotated';else f.account.generation='5';await expect(f.issue()).rejects.toThrow();expect(f.tx.insertSession).not.toHaveBeenCalled();}
});
it('Discord issuance consumes generation-bound grant after User, never from Steam',async()=>{
 const f=fixture();await issueSession(f.tx,{userId:'u',expectedGeneration:'4',method:'DISCORD',ticketHash:'a'.repeat(64),browserHash:'b'.repeat(64)});expect(f.events).toEqual(['U','GRANT_LOCK','GRANT','INSERT','AUDIT']);
 vi.mocked(f.tx.claimDiscordGrant).mockResolvedValue(false);await expect(issueSession(f.tx,{userId:'u',expectedGeneration:'4',method:'DISCORD',ticketHash:'a'.repeat(64),browserHash:'b'.repeat(64)})).rejects.toThrow('LOGIN_GRANT_REJECTED');
 await expect(issueSession(f.tx,{userId:'u',expectedGeneration:'4',method:'STEAM'} as never)).rejects.toThrow();
});
it('strict ownership, method, generation and restriction validation',async()=>{
 for(const change of ['owner','generation','status','method','revoked']){const f=fixture(),c=await f.issue();if(change==='owner')f.getRow()!.userId='other';if(change==='generation')f.account.generation='5';if(change==='status')f.account.status='SUSPENDED';if(change==='method')f.getRow()!.method='DISCORD';if(change==='revoked')f.getRow()!.revokedAt=f.now[0];expect((await validateSession(f.store,c)).status).toBe('INVALID');}
});
it('registry outage differs from invalid or expired',async()=>{
 const f=fixture(),c=await f.issue();f.now[0]=c.expiresAt;expect((await validateSession(f.store,c)).status).toBe('EXPIRED');
 vi.mocked(f.store.transaction).mockRejectedValue(Error('database'));expect((await validateSession(f.store,c)).status).toBe('UNAVAILABLE');expect((await validateSession(f.store,{})).status).toBe('INVALID');
});
it('public projection excludes secrets and password; expiry is effective minimum',async()=>{
 const f=fixture(),c=await f.issue(),r=await validateSession(f.store,c);if(r.status!=='VALID')throw Error('fixture');const p=publicSession(r,Math.floor(c.expiresAt/1000)-1);
 expect(p.expires).toBe(new Date(c.expiresAt-1000).toISOString());expect(JSON.stringify(p)).not.toContain(c.secret);expect(p.user.role).toBe('ADMIN');expect(JSON.stringify(p)).not.toContain('passwordHash');expect(JSON.stringify(p)).not.toContain('generation');
});
it('legacy/password sessions never authorize linking',async()=>{const f=fixture(),c=await f.issue();expect((await validateSession(f.store,c,true)).status).toBe('INVALID');expect(parseClaims({})).toBeNull();});
it('revocation is U -> S -> write -> audit, idempotent and survives restrictions',async()=>{
 const f=fixture(),c=await f.issue();f.events.length=0;f.account.status='SUSPENDED';f.account.generation='5';expect(await revokeSession(f.store,c)).toBe('REVOKED');expect(f.events).toEqual(['U','S','REVOKE','AUDIT']);expect(await revokeSession(f.store,c)).toBe('ALREADY_REVOKED');
});
it('revocation failures and ambiguous commit are unconfirmed',async()=>{
 const f=fixture(),c=await f.issue();vi.mocked(f.tx.revokeSession).mockResolvedValue(false);expect(await revokeSession(f.store,c)).toBe('UNCONFIRMED');
 vi.mocked(f.store.transaction).mockImplementation(async fn=>{await fn(f.tx);throw Error('lost commit reply');});expect(await revokeSession(f.store,c)).toBe('UNCONFIRMED');
});
it('encoder delegates encryption, rejects default renewal overrun and ignores rewritten iat',async()=>{
 const f=fixture(),c=await f.issue();const token={authProtocol:1,sessionCore:c};let expiry=c.expiresAt/1000-1;
 const crypto={encode:vi.fn(async()=> 'ciphertext'),decode:vi.fn(async()=>({...token,iat:999999,exp:expiry}))};
 expect(await encodeAbsolute(crypto,token,'private-secret','cookie-salt',()=>f.now[0])).toBe('ciphertext');expect(crypto.encode.mock.calls[0]).toBeDefined();
 expiry=c.expiresAt/1000+1;await expect(encodeAbsolute(crypto,token,'private-secret','cookie-salt',()=>f.now[0])).rejects.toThrow('ENCODED_AUTHORITY_INVALID');
 expect(decodedClaims({...token,exp:c.expiresAt/1000},()=>c.expiresAt)).toBeNull();
});
it('slow encoder, tampered bindings and expiry fail closed without retries',async()=>{
 const f=fixture(),c=await f.issue();let calls=0;const crypto={encode:async()=>{calls++;f.now[0]=c.expiresAt;return 'ciphertext';},decode:async()=>({authProtocol:1,sessionCore:c,exp:c.expiresAt/1000})};
 await expect(encodeAbsolute(crypto,{authProtocol:1,sessionCore:c},'secret','salt',()=>f.now[0])).rejects.toThrow();expect(calls).toBe(1);
});
it('cookie bounds preserve chunks/security/deletions and remove positive Max-Age',()=>{
 const options={expires:new Date(50000),maxAge:10000,path:'/',httpOnly:true,secure:true,sameSite:'lax'};
 const input=[{name:'__Secure-authjs.session-token.0',value:'a',options},{name:'__Secure-authjs.session-token.1',value:'b',options},{name:'__Secure-authjs.session-token.2',value:'',options:{...options,maxAge:0,expires:new Date(0)}}];
 const result=boundCookies(input,'__Secure-authjs.session-token',10000,()=>0);expect(result.map(c=>c.value)).toEqual(['a','b','']);expect(result[0].options.expires).toEqual(new Date(10000));expect(result[0].options).not.toHaveProperty('maxAge');expect(result[2]).toEqual(input[2]);expect(result[0].options.httpOnly).toBe(true);expect(input[0].options.maxAge).toBe(10000);
 expect(()=>boundCookies([{...input[0],options:{...options,httpOnly:false}}],'__Secure-authjs.session-token',10000,()=>0)).toThrow();
});
function boundaryFixture(){const f=fixture();let token:any=null;const clear=vi.fn(async()=>[{name:'authjs.session-token.0',value:'',options:{maxAge:0,path:'/'}}]);const boundary=sessionBoundary({store:f.store,sessionCookieName:'authjs.session-token',decodeCookie:async()=>token,clearCookie:clear,now:()=>f.now[0]});return {...f,clear,boundary,setToken:(t:unknown)=>{token=t;}};}
for(const path of ['/api/auth/logout','/api/auth/signout']){
 it('confirmed revocation before cookie clear '+path,async()=>{const f=boundaryFixture(),c=await f.issue();f.setToken({authProtocol:1,sessionCore:c,exp:c.expiresAt/1000});const result=await f.boundary.dispatch(new Request('https://synthetic.invalid'+path,{method:'POST'}));expect(result.body).toEqual({status:'SESSION_REVOKED'});expect(f.getRow()?.revokedAt).not.toBeNull();expect(f.clear).toHaveBeenCalledOnce();});
 it('revocation failure preserves cookies '+path,async()=>{const f=boundaryFixture(),c=await f.issue();f.setToken({authProtocol:1,sessionCore:c,exp:c.expiresAt/1000});vi.mocked(f.store.transaction).mockRejectedValue(Error('database'));const r=await f.boundary.dispatch(new Request('https://synthetic.invalid'+path,{method:'POST'}));expect(r.status).toBe(503);expect(r.cookies).toEqual([]);expect(f.clear).not.toHaveBeenCalled();});
}
for(const method of ['GET','POST'])it('registry outage during '+method+' session does not clear/renew',async()=>{
 const f=boundaryFixture(),c=await f.issue();f.setToken({authProtocol:1,sessionCore:c,exp:c.expiresAt/1000});vi.mocked(f.store.transaction).mockRejectedValue(Error('database'));const r=await f.boundary.dispatch(new Request('https://synthetic.invalid/api/auth/session',{method}));expect(r.status).toBe(503);expect(r.cookies).toEqual([]);expect(f.clear).not.toHaveBeenCalled();
});
it('legacy/malformed JWTs cannot become versioned sessions',async()=>{const f=boundaryFixture();for(const token of [{sub:'legacy'},{authProtocol:1},{sessionCore:{}}]){f.setToken(token);expect((await f.boundary.read(new Request('https://synthetic.invalid/api/auth/session'))).status).not.toBe(200);}expect(f.tx.insertSession).not.toHaveBeenCalled();});
it('cookie failure after revocation is partial, not successful logout',async()=>{const f=boundaryFixture(),c=await f.issue();f.setToken({authProtocol:1,sessionCore:c,exp:c.expiresAt/1000});f.clear.mockRejectedValue(Error('cookies'));expect((await f.boundary.logout(new Request('https://synthetic.invalid/api/auth/logout'))).body).toEqual({status:'SESSION_REVOKED_COOKIE_CLEAR_UNCONFIRMED'});expect(f.getRow()?.revokedAt).not.toBeNull();});
it('fake User-lock serializes concurrent issuance and rotation; not PostgreSQL proof',async()=>{
 const f=fixture();let release:()=>void=()=>{};const held=new Promise<void>(r=>{release=r;});f.tx.lockAccount=vi.fn(async()=>{await held;return f.account;});
 const pending=f.issue();f.account.generation='5';release();await expect(pending).rejects.toThrow('SESSION_ISSUANCE_REJECTED');expect(f.tx.insertSession).not.toHaveBeenCalled();
});

it('unsupported generation/time claims fail closed without local persistence fallback',()=>{
 const base={version:1,userId:'u',secret:'a'.repeat(43),generation:'1',method:'DISCORD',authenticatedAt:1,expiresAt:1+ABSOLUTE_MS};
 for(const change of [{generation:'01'},{generation:'9223372036854775808'},{generation:1},{expiresAt:Infinity},{authenticatedAt:-1},{method:'STEAM'},{extra:true}])expect(parseClaims({...base,...change})).toBeNull();
});
it('invalid JWT decode never triggers automatic cookie clearing',async()=>{
 const clear=vi.fn();const boundary=sessionBoundary({store:fixture().store,sessionCookieName:'authjs.session-token',decodeCookie:async()=>{throw Error('JWT callback or decoder failure');},clearCookie:clear});
 const r=await boundary.read(new Request('https://synthetic.invalid/api/auth/session'));expect(r.status).toBe(401);expect(r.cookies).toEqual([]);expect(clear).not.toHaveBeenCalled();
});
it('post-revocation copied JWT cannot authorize validation',async()=>{const f=fixture(),c=await f.issue();expect(await revokeSession(f.store,c)).toBe('REVOKED');expect((await validateSession(f.store,c)).status).toBe('INVALID');});
it('client-updated fields and altered secret/session generation do not authorize',async()=>{const f=fixture(),c=await f.issue();for(const change of [{secret:'b'.repeat(43)},{generation:'5'},{userId:'other'}])expect((await validateSession(f.store,{...c,...change})).status).toBe('INVALID');});

it('grant expiry during lock wait rejects consumption and issuance using fresh DB time',async()=>{
 const f=fixture();const expiresAt=f.now[0]+10;
 let release!:()=>void,entered!:()=>void;
 const locked=new Promise<void>(r=>{release=r;});const waiting=new Promise<void>(r=>{entered=r;});
 f.tx.lockDiscordGrant=vi.fn(async()=>{entered();await locked;return {ticketHash:'a'.repeat(64),browserHash:'b'.repeat(64),userId:'u',generation:'4',provider:'DISCORD',expiresAt,consumedAt:null};});
 const pending=issueSession(f.tx,{userId:'u',expectedGeneration:'4',method:'DISCORD',ticketHash:'a'.repeat(64),browserHash:'b'.repeat(64)});
 const rejected=expect(pending).rejects.toThrow('LOGIN_GRANT_REJECTED');
 await waiting;f.now[0]=expiresAt+1;release();await rejected;
 expect(f.tx.claimDiscordGrant).not.toHaveBeenCalled();expect(f.tx.insertSession).not.toHaveBeenCalled();expect(f.tx.audit).not.toHaveBeenCalled();
});
it('grant consumption and session timestamps use post-lock database time',async()=>{
 const f=fixture();const original=f.tx.lockDiscordGrant;
 f.tx.lockDiscordGrant=async hash=>{f.now[0]+=500;return original(hash);};
 const claims=await issueSession(f.tx,{userId:'u',expectedGeneration:'4',method:'DISCORD',ticketHash:'a'.repeat(64),browserHash:'b'.repeat(64)});
 expect(f.tx.claimDiscordGrant).toHaveBeenCalledWith(expect.objectContaining({now:f.now[0]}));expect(claims.authenticatedAt).toBe(f.now[0]);
});
for(const change of [{provider:'STEAM'},{generation:'5'},{userId:'other'},{browserHash:'c'.repeat(64)},{ticketHash:'c'.repeat(64)},{consumedAt:1},{expiresAt:1000000}])it('locked grant binding rejected '+JSON.stringify(change),async()=>{
 const f=fixture();const grant=await f.tx.lockDiscordGrant('a'.repeat(64));
 vi.mocked(f.tx.lockDiscordGrant).mockResolvedValue({...grant!,...change});
 await expect(issueSession(f.tx,{userId:'u',expectedGeneration:'4',method:'DISCORD',ticketHash:'a'.repeat(64),browserHash:'b'.repeat(64)})).rejects.toThrow('LOGIN_GRANT_REJECTED');
 expect(f.tx.claimDiscordGrant).not.toHaveBeenCalled();expect(f.tx.insertSession).not.toHaveBeenCalled();
});
