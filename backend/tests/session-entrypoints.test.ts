import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({rawClear:vi.fn(),rawAuth:vi.fn(),rawGet:vi.fn(),rawPost:vi.fn(),decode:vi.fn(),read:vi.fn(),logout:vi.fn(),request:null as any,config:null as any}));
vi.mock('next-auth',()=>({default:(config:any)=>{m.config=config;return {auth:m.rawAuth,signIn:vi.fn(),signOut:m.rawClear,handlers:{GET:m.rawGet,POST:m.rawPost}};}}));
vi.mock('@/lib/prisma',()=>({prisma:{}}));
vi.mock('@/lib/rate-limit',()=>({enforceRateLimit:vi.fn()}));
vi.mock('@/lib/session-auth-adapter',()=>({cookieToken:m.decode,currentRequest:async()=>m.request,versioned:(t:any)=>Boolean(t&&('authProtocol'in t||'sessionCore'in t)),
 runtimeBoundary:()=>({read:m.read,logout:m.logout,dispatch:m.read}),boundaryResponse:(r:any)=>Response.json(r.body,{status:r.status}),encodeVersioned:vi.fn(),authJsCrypto:{encode:vi.fn()}}));
import * as auth from '../auth';
import {POST as customLogout} from '../app/api/auth/logout/route';
import {GET as frameworkGet,POST as frameworkPost} from '../app/api/auth/[...nextauth]/route';
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('APP_URL','https://arena.example');m.request=new Request('https://arena.example/api/auth/session');m.decode.mockResolvedValue({sub:'legacy'});m.rawClear.mockResolvedValue({});m.rawAuth.mockResolvedValue({user:{id:'legacy',role:'ADMIN'}});m.rawGet.mockResolvedValue(Response.json({legacy:true}));m.rawPost.mockResolvedValue(Response.json({legacy:true}));});
function req(path:string,method='POST'){return new Request('https://arena.example'+path,{method,headers:{origin:'https://arena.example'}});}
it('custom logout and direct Auth.js signout both use wrapped legacy logout with honest status',async()=>{
 expect(await (await customLogout(req('/api/auth/logout'),undefined)).json()).toEqual({status:'LEGACY_COOKIE_CLEARED'});
 expect(await (await frameworkPost(req('/api/auth/signout') as never,undefined)).json()).toEqual({status:'LEGACY_COOKIE_CLEARED'});
 expect(m.rawClear).toHaveBeenCalledTimes(2);expect(m.rawPost).not.toHaveBeenCalled();
});
it('server signOut uses same wrapper; no raw export exists',async()=>{expect(await auth.signOut({redirect:false})).toEqual({status:'LEGACY_COOKIE_CLEARED'});expect(Object.keys(auth).sort()).toEqual(['auth','handlers','signIn','signOut']);});
for(const entry of ['custom','framework','server'])it('versioned revocation failure stops clearing through '+entry,async()=>{
 m.decode.mockResolvedValue({authProtocol:1,sessionCore:{}});m.logout.mockResolvedValue({status:503,body:{status:'REVOCATION_UNCONFIRMED'},cookies:[]});
 if(entry==='server')await expect(auth.signOut()).rejects.toThrow('REVOCATION_UNCONFIRMED');
 else {const result=entry==='custom'?await customLogout(req('/api/auth/logout'),undefined):await frameworkPost(req('/api/auth/signout') as never,undefined);expect(result.status).toBe(503);}
 expect(m.rawClear).not.toHaveBeenCalled();expect(m.rawPost).not.toHaveBeenCalled();
});
it('framework GET signout never mutates cookies',async()=>{expect((await frameworkGet(req('/api/auth/signout','GET') as never)).status).toBe(405);expect(m.rawClear).not.toHaveBeenCalled();expect(m.rawGet).not.toHaveBeenCalled();});
for(const method of ['GET','POST'])it('versioned '+method+' session outage bypasses core automatic cleanup/renewal',async()=>{
 m.decode.mockResolvedValue({authProtocol:1});m.read.mockResolvedValue({status:503,body:{error:'SESSION_REGISTRY_UNAVAILABLE'},cookies:[]});
 const r=method==='GET'?await frameworkGet(req('/api/auth/session',method) as never):await frameworkPost(req('/api/auth/session',method) as never,undefined);
 expect(r.status).toBe(503);expect(m.rawGet).not.toHaveBeenCalled();expect(m.rawPost).not.toHaveBeenCalled();expect(m.rawClear).not.toHaveBeenCalled();
});
it('server auth registry outage is unavailable, not legacy/signed-out success',async()=>{m.decode.mockResolvedValue({authProtocol:1});m.read.mockResolvedValue({status:503,body:{error:'SESSION_REGISTRY_UNAVAILABLE'},cookies:[]});await expect(auth.auth()).rejects.toThrow('SESSION_REGISTRY_UNAVAILABLE');expect(m.rawAuth).not.toHaveBeenCalled();});
it('legacy admin server reads remain available before rollout',async()=>{expect((await auth.auth())?.user.role).toBe('ADMIN');expect(m.rawAuth).toHaveBeenCalledOnce();});
it('ambiguous auth action and client cross-origin signout denied before dispatch',async()=>{
 expect((await auth.handlers.POST(req('/api/auth/%73ignout'))).status).toBe(400);expect(m.rawPost).not.toHaveBeenCalled();
 const r=await frameworkPost(new Request('https://arena.example/api/auth/signout',{method:'POST',headers:{origin:'https://attacker.invalid'}}) as never,undefined);expect(r.status).toBe(403);expect(m.rawClear).not.toHaveBeenCalled();
});
it('encoder cannot mint versioned authority while runtime activation is blocked',async()=>{await expect(m.config.jwt.encode({token:{authProtocol:1},secret:'synthetic',salt:'cookie'})).rejects.toThrow('SESSION_CORE_NOT_ACTIVATED');});
it('invalid and absent browser cookies never claim legacy or durable revocation',async()=>{
 m.decode.mockResolvedValue(null);m.request=new Request('https://arena.example/api/auth/session',{headers:{cookie:'authjs.session-token=unverifiable'}});
 expect(await auth.signOut()).toEqual({status:'INVALID_COOKIE_CLEARED'});
 m.request=new Request('https://arena.example/api/auth/session');expect(await auth.signOut()).toEqual({status:'NO_SESSION_COOKIE'});
});
it('client session-update data cannot overwrite private JWT authority',async()=>{
 const token={authProtocol:1,sessionCore:{secret:'server-private'},role:'PLAYER'};
 const result=await m.config.callbacks.jwt({token,user:undefined,trigger:'update',session:{authProtocol:0,sessionCore:{secret:'attacker'},role:'ADMIN'}});
 expect(result).toBe(token);expect(result.sessionCore.secret).toBe('server-private');expect(result.role).toBe('PLAYER');
});
it('unexpected callback failures cannot reach core renewal for versioned session reads',async()=>{
 m.decode.mockResolvedValue({authProtocol:1});m.rawGet.mockRejectedValue(Error('automatic callback cleanup'));
 m.read.mockResolvedValue({status:503,body:{error:'SESSION_REGISTRY_UNAVAILABLE'},cookies:[]});
 expect((await frameworkGet(req('/api/auth/session','GET') as never)).status).toBe(503);expect(m.rawGet).not.toHaveBeenCalled();expect(m.rawClear).not.toHaveBeenCalled();
});

for(const entry of ['custom','framework','server'])for(const outcome of ['REVOCATION_UNCONFIRMED','SESSION_REVOKED_COOKIE_CLEAR_UNCONFIRMED'])it(entry+' preserves sanitized '+outcome,async()=>{
 m.decode.mockResolvedValue({authProtocol:1,sessionCore:{}});
 m.logout.mockResolvedValue({status:503,body:{status:outcome},cookies:[]});
 if(entry==='server')await expect(auth.signOut()).rejects.toThrow(outcome);
 else {
   const response=entry==='custom'?await customLogout(req('/api/auth/logout'),undefined):await frameworkPost(req('/api/auth/signout') as never,undefined);
   expect(response.status).toBe(503);expect(await response.json()).toEqual({error:outcome});
 }
 expect(m.rawClear).not.toHaveBeenCalled();expect(m.rawPost).not.toHaveBeenCalled();
});
for(const entry of ['custom','framework','server'])it(entry+' refuses successful logout before cookie descriptors are published',async()=>{
 m.decode.mockResolvedValue({authProtocol:1,sessionCore:{}});
 m.logout.mockResolvedValue({status:200,body:{status:'SESSION_REVOKED'},cookies:[{name:'authjs.session-token',value:'',options:{maxAge:0,path:'/'}}]});
 if(entry==='server')await expect(auth.signOut()).rejects.toThrow('SESSION_REVOKED_COOKIE_CLEAR_UNCONFIRMED');
 else {const r=entry==='custom'?await customLogout(req('/api/auth/logout'),undefined):await frameworkPost(req('/api/auth/signout') as never,undefined);expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'SESSION_REVOKED_COOKIE_CLEAR_UNCONFIRMED'});}
 expect(m.rawClear).not.toHaveBeenCalled();
});
it('unexpected direct logout failures are sanitized, not reflected to clients',async()=>{
 m.decode.mockResolvedValue({authProtocol:1});m.logout.mockRejectedValue(Error('private backend detail'));
 const response=await frameworkPost(req('/api/auth/signout') as never,undefined);
 expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'REVOCATION_UNCONFIRMED'});
});

for(const entry of ['custom','framework','server'])it(entry+' preserves confirmed revocation from a completed mock boundary',async()=>{
 m.decode.mockResolvedValue({authProtocol:1});m.logout.mockResolvedValue({status:200,body:{status:'SESSION_REVOKED'},cookies:[]});
 // Fake completed boundary only: no real cookie writer or database is exercised.
 if(entry==='server')expect(await auth.signOut()).toEqual({status:'SESSION_REVOKED'});
 else {const r=entry==='custom'?await customLogout(req('/api/auth/logout'),undefined):await frameworkPost(req('/api/auth/signout') as never,undefined);expect(r.status).toBe(200);expect(await r.json()).toEqual({status:'SESSION_REVOKED'});}
 expect(m.rawClear).not.toHaveBeenCalled();expect(m.rawPost).not.toHaveBeenCalled();
});
