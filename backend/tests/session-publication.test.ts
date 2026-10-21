import {it,expect,vi} from 'vitest';
import {publishIssuedSession} from '../lib/session-publication';
import {ABSOLUTE_MS,type Claims} from '../lib/persistent-session';
const claims:Claims={version:1,userId:'u',secret:'a'.repeat(43),generation:'0',method:'DISCORD',authenticatedAt:0,expiresAt:ABSOLUTE_MS};
function fixture(){return {expectedClaims:claims,existingSessionCookies:[] as Array<{name:string;value:string}>,response:{status:200,cookies:[{name:'authjs.session-token.0',value:'encrypted-a',options:{expires:new Date(ABSOLUTE_MS*2),maxAge:100000,path:'/',httpOnly:true,secure:false,sameSite:'lax'}}]},sessionCookieName:'authjs.session-token',decodeIssued:vi.fn(async(_cookies:import('../lib/session-codec').Cookie[])=>({authProtocol:1,sessionCore:claims,exp:ABSOLUTE_MS/1000})),publish:vi.fn(async(_cookies:import('../lib/session-codec').Cookie[])=>{}),now:()=>1000};}
it('held response verified and bounded before single cookie publication',async()=>{const f=fixture();expect(await publishIssuedSession(f)).toBe('PUBLISHED');expect(f.publish).toHaveBeenCalledOnce();const cookie=(f.publish.mock.calls as any)[0][0][0];expect(cookie.value).toBe('encrypted-a');expect(cookie.options.expires).toEqual(new Date(ABSOLUTE_MS));expect(cookie.options).not.toHaveProperty('maxAge');});
it('cookie writer failure after issuance is uncertain, with no retry or fake rollback',async()=>{const f=fixture();f.publish.mockRejectedValue(Error('cookie failure'));expect(await publishIssuedSession(f)).toBe('SESSION_ISSUED_COOKIE_UNCONFIRMED');expect(f.publish).toHaveBeenCalledOnce();});
it('invalid or expired encoded output prevents publication',async()=>{const f=fixture();f.decodeIssued.mockResolvedValue({authProtocol:1,sessionCore:claims,exp:99999999});expect(await publishIssuedSession(f)).toBe('SESSION_ISSUED_COOKIE_UNCONFIRMED');expect(f.publish).not.toHaveBeenCalled();});
it('unexpected core cleanup response cannot be accepted as successful issuance',async()=>{const f=fixture();f.response.cookies[0].value='';f.response.cookies[0].options.maxAge=0;expect(await publishIssuedSession(f)).toBe('SESSION_ISSUED_COOKIE_UNCONFIRMED');expect(f.publish).not.toHaveBeenCalled();});
it('registry outage must be handled before dispatch; no unapproved runtime activation',async()=>{const {persistentSessionsEnabled,unavailableSessionStore,sessionTransactionAdapter}=await import('../lib/session-runtime');expect(persistentSessionsEnabled()).toBe(false);await expect(unavailableSessionStore.transaction(async()=>true)).rejects.toThrow('SESSION_SCHEMA_ADAPTER_REQUIRED');expect(()=>sessionTransactionAdapter({} as never)).toThrow('SESSION_SCHEMA_ADAPTER_REQUIRED');});

for(const change of [
  {userId:'other'},{secret:'b'.repeat(43)},{generation:'1'},
  {method:'LEGACY_PASSWORD' as const},
  {authenticatedAt:1,expiresAt:ABSOLUTE_MS+1},
  {expiresAt:ABSOLUTE_MS+1},
])it('rejects substituted issuance claims '+JSON.stringify(change),async()=>{
  const f=fixture();f.decodeIssued.mockResolvedValue({authProtocol:1,sessionCore:{...claims,...change},exp:ABSOLUTE_MS/1000});
  expect(await publishIssuedSession(f)).toBe('SESSION_ISSUED_COOKIE_UNCONFIRMED');expect(f.publish).not.toHaveBeenCalled();
});
function live(name:string,value='encrypted'){return {name,value,options:{expires:new Date(ABSOLUTE_MS*2),maxAge:100000,path:'/',httpOnly:true,secure:false,sameSite:'lax'}};}
function deletion(name:string){return {...live(name,''),options:{...live(name).options,maxAge:0,expires:new Date(0)}};}
const base='authjs.session-token';
for(const example of [
 {name:'live then delete',cookies:[live(base),deletion(base)],existing:[],pass:false},
 {name:'delete then live',cookies:[deletion(base),live(base)],existing:[{name:base,value:'old'}],pass:true},
 {name:'chunked to unchunked',cookies:[deletion(base+'.0'),deletion(base+'.1'),live(base)],existing:[{name:base+'.0',value:'old0'},{name:base+'.1',value:'old1'}],pass:true},
 {name:'unchunked to chunked',cookies:[deletion(base),live(base+'.0'),live(base+'.1')],existing:[{name:base,value:'old'}],pass:true},
 {name:'stale chunk',cookies:[live(base+'.0')],existing:[{name:base+'.0',value:'old0'},{name:base+'.1',value:'old1'}],pass:false},
 {name:'missing chunk',cookies:[live(base+'.0'),live(base+'.2')],existing:[],pass:false},
 {name:'conflicting representations',cookies:[live(base),live(base+'.0')],existing:[],pass:false},
 {name:'undeleted old representation',cookies:[live(base+'.0')],existing:[{name:base,value:'old'}],pass:false},
 {name:'noncanonical chunk',cookies:[live(base+'.00')],existing:[],pass:false},
 {name:'deletion of missing chunk does not fill gap',cookies:[live(base+'.0'),deletion(base+'.1'),live(base+'.2')],existing:[],pass:false},
])it('ordered effective cookies: '+example.name,async()=>{
 const f=fixture();f.response.cookies=example.cookies;f.existingSessionCookies=example.existing;
 expect(await publishIssuedSession(f)).toBe(example.pass?'PUBLISHED':'SESSION_ISSUED_COOKIE_UNCONFIRMED');
 expect(f.publish).toHaveBeenCalledTimes(example.pass?1:0);
 if(example.pass){
   const effective=f.decodeIssued.mock.calls[0][0];
   expect(effective.map(c=>c.name)).toEqual(example.cookies.filter(c=>c.value!=='').map(c=>c.name));
   expect(f.publish.mock.calls[0][0].map(c=>c.value)).toEqual(example.cookies.map(c=>c.value));
 }
});
it('effective cookies still require successful Auth.js decryption',async()=>{
 const f=fixture();f.decodeIssued.mockRejectedValue(Error('invalid ciphertext'));
 expect(await publishIssuedSession(f)).toBe('SESSION_ISSUED_COOKIE_UNCONFIRMED');expect(f.publish).not.toHaveBeenCalled();
});
it('wrong-scope deletion and insecure replacement are rejected before decoding',async()=>{
 for(const options of [{path:'/other'},{domain:'example.invalid'}]){
   const f=fixture();const d=deletion(base);Object.assign(d.options,options);f.response.cookies=[d,live(base)];
   expect(await publishIssuedSession(f)).toBe('SESSION_ISSUED_COOKIE_UNCONFIRMED');expect(f.decodeIssued).not.toHaveBeenCalled();expect(f.publish).not.toHaveBeenCalled();
 }
 const f=fixture();f.response.cookies[0].options.httpOnly=false;
 expect(await publishIssuedSession(f)).toBe('SESSION_ISSUED_COOKIE_UNCONFIRMED');expect(f.publish).not.toHaveBeenCalled();
});

it('already expired live descriptor cannot establish effective publication',async()=>{
 const f=fixture();f.response.cookies[0].options.expires=new Date(1000);
 expect(await publishIssuedSession(f)).toBe('SESSION_ISSUED_COOKIE_UNCONFIRMED');expect(f.publish).not.toHaveBeenCalled();
});
it('ambiguous incoming cookie snapshot and missing issuance binding fail closed',async()=>{
 const f=fixture();f.existingSessionCookies=[{name:base,value:'old'},{name:base,value:'duplicate'}];
 expect(await publishIssuedSession(f)).toBe('SESSION_ISSUED_COOKIE_UNCONFIRMED');expect(f.publish).not.toHaveBeenCalled();
 const missing=fixture();await expect(publishIssuedSession({...missing,expectedClaims:undefined as never})).resolves.toBe('SESSION_ISSUED_COOKIE_UNCONFIRMED');expect(missing.publish).not.toHaveBeenCalled();
});
