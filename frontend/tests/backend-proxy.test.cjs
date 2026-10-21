// Only Node built-ins and the installed TypeScript transpiler. No app bootstrapping.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const filename = path.join(__dirname, '../lib/server/backend-proxy.ts');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const policy = require('../server/ingress-policy.cjs');
const key = 'a'.repeat(64);
const exportsObject = {};
vm.runInNewContext(source, { exports: exportsObject, Response, Request, Headers, URL,
  AbortController, Uint8Array, setTimeout, clearTimeout,
  require(name) { if(name === 'server-only') return {}; if(name === '../../server/ingress-policy.cjs') return policy; throw new Error('UNEXPECTED_IMPORT'); }
});
const { proxyRequest, BODY_LIMIT } = exportsObject;
const env = { FRONTEND_CANONICAL_ORIGIN: 'http://localhost:3002', BACKEND_INTERNAL_ORIGIN: 'http://127.0.0.1:3001', NODE_ENV:'development', NUUDEL_LOCAL_INGRESS_MODE:'development-v1', NUUDEL_LOCAL_INGRESS_KEY:key };
function stamp(req) {
  const url=new URL(req.url); const incoming={method:req.method,url:url.pathname+url.search,headers:Object.fromEntries(req.headers)};
  policy.sealIncoming(incoming,key);req.headers.set(policy.MARKER,incoming.headers[policy.MARKER]);
  for(const [name,value] of Object.entries({'x-forwarded-host':'localhost:3002','x-forwarded-proto':'http','x-forwarded-port':'3002','x-forwarded-for':'127.0.0.1'})) if(!req.headers.has(name)) req.headers.set(name,value);
  return req;
}
function request(route, method = 'GET', extra = {}) {
  return stamp(new Request(`http://localhost:3002${route}`, { method,
    headers: { host: 'localhost:3002', ...(method === 'POST' ? { origin: env.FRONTEND_CANONICAL_ORIGIN, 'content-type': 'application/json' } : {}), ...extra.headers },
    ...(method === 'POST' ? { body: extra.body ?? '{}' } : {}) }));
}
async function run(req, response = Response.json({ ok: true }), overrides = {}) {
  const calls = [];
  const result = await proxyRequest(req, { env, fetch: async (...args) => { calls.push(args); return response; }, ...overrides });
  return { result, calls };
}
for (const route of ['/api/register', '/api/auth/login', '/api/auth/logout', '/api/identity/steam/start', '/api/identity/discord/start']) {
  test(`allowed POST ${route}`, async () => { const { result, calls } = await run(request(route, 'POST')); assert.equal(result.status, 200); assert.equal(calls.length, 1); });
}
for (const route of ['/api/auth/session', '/api/auth/csrf', '/api/auth/providers', '/api/identity/status', '/api/tournaments', '/api/tournaments/event_1', '/api/leaderboard', '/api/players/NMD-000001/history']) {
  test(`allowed GET ${route}`, async () => { const { result, calls } = await run(request(route)); assert.equal(result.status, 200); assert.equal(calls.length, 1); assert.equal(result.headers.get('cache-control'), 'no-store'); });
}
for (const [route, method] of [['/api/admin/users','GET'],['/api/tournaments','POST'],['/api/tournaments/mine','GET'],['/api/auth/login','GET'],['/api/auth/session','DELETE'],['/api/identity/steam/revoke','POST']]) {
  test(`denied ${method} ${route}`, async () => { const { result, calls } = await run(request(route, method)); assert.equal(result.status, 404); assert.equal(calls.length, 0); });
}
test('configuration absent, changed, trailing slash fail closed', async () => {
  for (const settings of [{}, { ...env, BACKEND_INTERNAL_ORIGIN: 'https://evil.test' }, { ...env, FRONTEND_CANONICAL_ORIGIN: 'http://localhost:3002/' }]) {
    const { result, calls } = await run(request('/api/auth/session'), undefined, { env: settings }); assert.equal(result.status, 503); assert.equal(calls.length, 0);
  }
});
test('host and mutation origin required; cross-site denied', async () => {
  for (const headers of [{ host: 'evil.test' }, { origin: '' }, { origin: 'https://evil.test' }, { 'sec-fetch-site': 'cross-site' }]) {
    const { result, calls } = await run(request('/api/auth/login', 'POST', { headers })); assert.equal(result.status, 403); assert.equal(calls.length, 0);
  }
});
test('post-handoff unexpected forwarding values rejected', async () => {
  for (const name of ['forwarded','x-forwarded-host','x-forwarded-proto','x-forwarded-for','x-forwarded-port','x-real-ip']) {
    const { result, calls } = await run(request('/api/auth/session', 'GET', { headers: { [name]: 'spoof' } })); assert.equal(result.status,403); assert.equal(calls.length,0);
  }
});
test('ambiguous and encoded paths rejected', async () => {
  for (const route of ['/api//auth/session','/api/%61uth/session','/api/%252e%252e/auth/session','/api/tournaments/id%2Fadmin']) {
    const { result, calls } = await run(request(route)); assert.equal(result.status,400); assert.equal(calls.length,0);
  }
});
test('visible raw dot traversal rejected before normalization', async () => {
  const req = request('/api/auth/session'); Object.defineProperty(req, 'url', { value: 'http://localhost:3002/api/no/../auth/session' });
  const { result, calls } = await run(req); assert.equal(result.status,400); assert.equal(calls.length,0);
});
test('callback query preserved including repeated values; credentials forwarded only to fixed origin', async () => {
  const query = '?state=abc&code=a%2Bb&code=second';
  const { calls } = await run(request('/api/identity/discord/callback' + query, 'GET', { headers: { cookie:'synthetic=value', origin:'https://discord.com', 'sec-fetch-site':'cross-site', authorization:'secret-not-forwarded' } }));
  assert.equal(calls[0][0], env.BACKEND_INTERNAL_ORIGIN + '/api/identity/discord/callback' + query);
  const init = calls[0][1]; assert.equal(init.headers.get('cookie'),'synthetic=value'); assert.equal(init.headers.get('origin'),'https://discord.com');
  assert.equal(init.headers.get('sec-fetch-site'),'cross-site'); assert.equal(init.headers.get('authorization'),null);
  assert.equal(init.headers.get('x-forwarded-host'),'localhost:3002'); assert.equal(init.headers.get('x-forwarded-proto'),'http');
  assert.equal(init.redirect,'manual'); assert.equal(init.cache,'no-store');
});
test('login and logout cookies preserved independently, including expiry', async () => {
  const cookies = ['authjs.session-token.0=a; Path=/; HttpOnly; SameSite=Lax', 'authjs.session-token.1=b; Path=/; HttpOnly; SameSite=Lax', 'identity-steam=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly'];
  for (const route of ['/api/auth/login','/api/auth/logout']) {
    const headers = new Headers(); cookies.forEach(c => headers.append('set-cookie',c));
    const { result } = await run(request(route,'POST'), new Response('{}',{headers})); assert.deepEqual(result.headers.getSetCookie(), cookies);
  }
});
test('upstream errors and signed-out sessions preserved', async () => {
  for (const [status,payload] of [[200,null],[401,{error:'UNAUTHORIZED'}],[403,{error:'FORBIDDEN'}]]) {
    const { result } = await run(request('/api/auth/session'), Response.json(payload,{status})); assert.equal(result.status,status); assert.deepEqual(await result.json(),payload);
  }
});
test('only canonical callback redirect accepted', async () => {
  const { result } = await run(request('/api/identity/steam/callback'),new Response(null,{status:307,headers:{location:'/identity'}}));
  assert.equal(result.status,307); assert.equal(result.headers.get('location'),env.FRONTEND_CANONICAL_ORIGIN+'/identity');
  for (const location of ['https://evil.test/identity','http://127.0.0.1:3001/identity','//evil.test/identity','/identity?ticket=secret','http://user@localhost:3002/identity']) {
    const { result } = await run(request('/api/identity/steam/callback'),new Response(null,{status:302,headers:{location}})); assert.equal(result.status,502);
  }
  const denied = await run(request('/api/auth/session'),new Response(null,{status:302,headers:{location:'/identity'}})); assert.equal(denied.result.status,502);
});
test('domain cookies rejected', async () => {
  const { result } = await run(request('/api/auth/session'),new Response('{}',{headers:{'set-cookie':'session=x; Domain=localhost; HttpOnly'}})); assert.equal(result.status,502); assert.equal(result.headers.get('set-cookie'),null);
});
test('body byte limit and content length rejected before fetch', async () => {
  for (const extra of [{body:'x'.repeat(BODY_LIMIT+1)}, {headers:{'content-length':String(BODY_LIMIT+1)}}, {headers:{'content-length':'bad'}}]) {
    const { result,calls } = await run(request('/api/auth/login','POST',extra)); assert.equal(result.status,413); assert.equal(calls.length,0);
  }
});
test('non-JSON request rejected',async()=> { const {result,calls}=await run(request('/api/auth/login','POST',{headers:{'content-type':'text/plain'}})); assert.equal(result.status,415); assert.equal(calls.length,0); });
test('upstream timeout aborts once, no retries',async()=> {
  let calls=0; const result=await proxyRequest(request('/api/auth/session'),{env,timeoutMs:5,fetch:async(_url,init)=>{calls++;return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('private detail')),{once:true}));}});
  assert.equal(result.status,504); assert.equal(calls,1); assert.deepEqual(await result.json(),{error:'PROXY_TIMEOUT'});
});
test('network failure sanitized and never retried',async()=> {
  let calls=0; const result=await proxyRequest(request('/api/auth/session'),{env,fetch:async()=>{calls++;throw new Error('password=cookie=private');}});
  assert.equal(calls,1); assert.equal(result.status,502); assert.deepEqual(await result.json(),{error:'UPSTREAM_UNAVAILABLE'});
});
test('response size and response stream timeout fail closed',async()=> {
  const large=await run(request('/api/auth/session'),new Response('x'.repeat(2*1024*1024+1)));
  assert.equal(large.result.status,413);assert.equal(large.result.headers.get('set-cookie'),null);
  const pending=new ReadableStream({start(){}});
  const timed=await run(request('/api/auth/session'),new Response(pending),{timeoutMs:5});
  assert.equal(timed.result.status,504);
});
test('client cancellation aborts upstream without cookies',async()=> {
  const ac=new AbortController(); let calls=0;
  const req=stamp(new Request(env.FRONTEND_CANONICAL_ORIGIN+'/api/auth/session',{headers:{host:'localhost:3002'},signal:ac.signal}));
  const promise=proxyRequest(req,{env,fetch:async(_url,init)=>{calls++;return new Promise((_,reject)=>{init.signal.addEventListener('abort',()=>reject(new Error('cancelled')));});}});
  ac.abort();const result=await promise;assert.equal(result.status,499);assert.equal(calls,1);assert.equal(result.headers.get('set-cookie'),null);
});
test('ordinary next entry bypass, forged proof and wrong launch key are denied before fetch',async()=> {
  for(const settings of [{...env,NUUDEL_LOCAL_INGRESS_KEY:undefined},{...env,NUUDEL_LOCAL_INGRESS_MODE:undefined},{...env,NODE_ENV:'production'},{...env,NUUDEL_LOCAL_INGRESS_KEY:'b'.repeat(64)}]) {
    const {result,calls}=await run(request('/api/auth/session'),undefined,{env:settings});assert.equal(result.status,403);assert.equal(calls.length,0);
  }
  const req=request('/api/auth/session');req.headers.set(policy.MARKER,'forged');
  const {result,calls}=await run(req);assert.equal(result.status,403);assert.equal(calls.length,0);
});
test('valid proof cannot bypass malformed Fetch Metadata checks',async()=> {
  for(const fields of [{'sec-fetch-site':'same-origin, cross-site'},{'sec-fetch-mode':'cors, navigate'},{'sec-fetch-user':'?0'},{'sec-fetch-dest':'invented'}]) {
    const {result,calls}=await run(request('/api/auth/session','GET',{headers:fields}));assert.equal(result.status,403);assert.equal(calls.length,0);
  }
});
test('rejected redirect aborts upstream signal and awaits response cancellation',async()=> {
  let cancelled=false,signal;
  const body=new ReadableStream({cancel(){cancelled=true;}});
  const result=await proxyRequest(request('/api/auth/session'),{env,fetch:async(_url,init)=>{signal=init.signal;return new Response(body,{status:302,headers:{location:'https://evil.test'}});}});
  assert.equal(result.status,502);assert.equal(cancelled,true);assert.equal(signal.aborted,true);assert.equal(result.headers.get('set-cookie'),null);
});
test('cookie rejection cancels response and cleanup failure stays fail-closed',async()=> {
  const body=new ReadableStream({cancel(){return Promise.reject(new Error('private'));}});
  const {result}=await run(request('/api/auth/session'),new Response(body,{headers:{'set-cookie':'s=x; Domain=evil.test'}}));
  assert.equal(result.status,502);assert.deepEqual(await result.json(),{error:'PROXY_CLEANUP_UNCONFIRMED'});
});
test('stalled cancellation is bounded and cannot return sensitive cookies',async()=> {
  const body=new ReadableStream({cancel(){return new Promise(()=>{});}});
  const {result}=await run(request('/api/auth/session'),new Response(body,{status:302,headers:{location:'https://evil.test','set-cookie':'s=synthetic'}}),{timeoutMs:8});
  assert.equal(result.status,502);assert.equal(result.headers.get('set-cookie'),null);
});
test('streaming request limit without a claimed length',async()=> {
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(BODY_LIMIT));c.enqueue(new Uint8Array(1));c.close();}});
  const req=stamp(new Request(env.FRONTEND_CANONICAL_ORIGIN+'/api/register',{method:'POST',headers:{host:'localhost:3002',origin:env.FRONTEND_CANONICAL_ORIGIN,'content-type':'application/json'},body:stream,duplex:'half'}));
  const {result,calls}=await run(req);assert.equal(result.status,413);assert.equal(calls.length,0);
});
test('request body timeout happens before fetch',async()=> {
  const stream=new ReadableStream({start(){}});
  const req=stamp(new Request(env.FRONTEND_CANONICAL_ORIGIN+'/api/register',{method:'POST',headers:{host:'localhost:3002',origin:env.FRONTEND_CANONICAL_ORIGIN,'content-type':'application/json'},body:stream,duplex:'half'}));
  const {result,calls}=await run(req,undefined,{timeoutMs:5});assert.equal(result.status,504);assert.equal(calls.length,0);
});
test('server-only build boundary is explicit',()=>assert.match(fs.readFileSync(filename,'utf8'),/^import 'server-only';/));
test('already cancelled request never calls upstream',async()=> {
  const ac=new AbortController();ac.abort();
  const req=stamp(new Request(env.FRONTEND_CANONICAL_ORIGIN+'/api/auth/session',{headers:{host:'localhost:3002'},signal:ac.signal}));
  const {result,calls}=await run(req);assert.equal(result.status,499);assert.equal(calls.length,0);
});
