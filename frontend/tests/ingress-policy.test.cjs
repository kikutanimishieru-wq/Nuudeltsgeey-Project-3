'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const p=require('../server/ingress-policy.cjs');
const key='b'.repeat(64);
function req(extra=[],method='GET',url='/api/auth/session') {
  const rawHeaders=['Host','localhost:3002',...extra];
  const request=new EventEmitter();
  Object.assign(request,{method,url,httpVersion:'1.1',rawHeaders,headers:{},complete:true,socket:{destroy(){this.destroyed=true;}}});
  for(let i=0;i<rawHeaders.length;i+=2) request.headers[rawHeaders[i].toLowerCase()]=rawHeaders[i+1];
  return request;
}
function res(){const r=new EventEmitter();r.writeHead=(status,headers)=>{r.status=status;r.headers=headers;r.headersSent=true;};r.end=body=>{r.body=body;r.writableFinished=true;r.emit('finish');};return r;}
test('normal GET and JSON POST accepted, missing metadata allowed',()=>{
  assert.equal(p.validateIncoming(req()),null);
  assert.equal(p.validateIncoming(req(['Origin','http://localhost:3002','Content-Length','2','Content-Type','application/json'],'POST','/api/register')),null);
});
for(const name of ['Host','Origin','Sec-Fetch-Site','Sec-Fetch-Mode','Sec-Fetch-Dest','Sec-Fetch-User','Content-Length','Cookie']) {
  test('duplicate '+name+' rejected',()=>{const fields=name==='Host'?[name,'localhost:3002']:[name,'x',name,'x'];assert.equal(p.validateIncoming(req(fields)),'DUPLICATE_HEADER');});
}
for(const name of ['X-Forwarded-Host','X-Forwarded-For','X-Forwarded-Proto','X-Forwarded-Port','Forwarded','X-Real-IP','X-Nuudel-Ingress-Proof','X-Nuudel-Ingress-Other']) {
  test('client marker/forwarding rejected '+name,()=>assert.equal(p.validateIncoming(req([name,'spoof'])),'UNTRUSTED_FORWARDING'));
}
for(const [name,value] of [['Sec-Fetch-Site','same-origin, cross-site'],['Sec-Fetch-Mode','wrong'],['Sec-Fetch-Dest','document, empty'],['Sec-Fetch-User','?0'],['Origin','null'],['Origin','http://localhost:3002, https://evil.test']]) {
  test('malformed '+name+' '+value,()=>assert.ok(p.validateIncoming(req([name,value]))));
}
for(const fields of [['Transfer-Encoding','chunked'],['Content-Length','2','Transfer-Encoding','chunked'],['Content-Length','02'],['Content-Length','16385'],['Connection','keep-alive, x-extra'],['Trailer','x-extra'],['Expect','100-continue']]) {
  test('framing/size rejected '+fields.join(' '),()=>assert.ok(p.validateIncoming(req(fields))));
}
for(const target of ['http://localhost:3002/api/auth/session','//api/auth/session','/api/../auth/session','/api/%2e%2e/auth/session','/api/auth%2fsession','/api/auth/session#x','/api/auth/session?bad=%xx','/api/auth\\session']) {
  test('ambiguous target '+target,()=>assert.equal(p.validateIncoming(req([],'GET',target)),'INVALID_TARGET'));
}
test('host, method, mutation origin and missing length rejected',()=>{
  assert.equal(p.validateIncoming({...req(),rawHeaders:[]}), 'INVALID_HOST');
  assert.equal(p.validateIncoming(req([],'DELETE')),'METHOD_NOT_ALLOWED');
  assert.equal(p.validateIncoming(req(['Content-Length','2'],'POST','/api/register')),'INVALID_ORIGIN');
  assert.equal(p.validateIncoming(req(['Origin','http://localhost:3002'],'POST','/api/register')),'LENGTH_REQUIRED');
});
test('header size/count and HTTP version bounded',()=>{
  assert.equal(p.validateIncoming(req(['X-Test','x'.repeat(16384)])),'HEADERS_TOO_LARGE');
  assert.equal(p.validateIncoming({...req(),httpVersion:'1.0'}),'INVALID_HEADERS');
});
test('proof binds target, method, cookies and origin; missing/wrong/expired fails',()=>{
  const incoming=req(['Cookie','mock=value']);p.sealIncoming(incoming,key,1700000000000);
  const request=new Request('http://localhost:3002'+incoming.url,{headers:incoming.headers});
  assert.equal(p.verifyProof(request,key,1700000000001),true);
  for(const badKey of [undefined,'c'.repeat(64)]) assert.equal(p.verifyProof(request,badKey,1700000000001),false);
  assert.equal(p.verifyProof(request,key,1700000060001),false);
  assert.equal(p.verifyProof(new Request('http://localhost:3002/api/identity/status',{headers:incoming.headers}),key,1700000000001),false);
  request.headers.set('cookie','changed');assert.equal(p.verifyProof(request,key,1700000000001),false);
});
test('plain next has no proof; supplied matching forwarding metadata cannot authorize',()=>{
  const r=new Request('http://localhost:3002/api/auth/session',{headers:{host:'localhost:3002','x-forwarded-host':'localhost:3002'}});
  assert.equal(p.verifyProof(r,key),false);
});
test('upgrade/connect never dispatch to Next even if it attaches a listener',()=>{
  class FakeServer extends EventEmitter {}
  const Server=p.guardedServerClass(FakeServer);const server=new Server();let called=0;
  server.on('upgrade',()=>called++);server.on('connect',()=>called++);
  for(const event of ['upgrade','connect']) {const socket={destroy(){this.destroyed=true;}};server.emit(event,req(),socket);assert.equal(socket.destroyed,true);}
  assert.equal(called,0);
  const response=res();server.emit('checkContinue',req(),response);assert.equal(response.status,417);
});
test('request listener seals before Next and does not consume stream',async()=>{
  let calls=0;const r=req(),response=res();
  p.makeRequestListener((input,output)=>{calls++;assert.ok(input.headers[p.MARKER]);assert.equal(input.listenerCount('data'),0);output.end('{}');},key)(r,response);
  assert.equal(calls,1);
});
test('rejected request never reaches Next',()=>{
  let calls=0;const response=res();p.makeRequestListener(()=>calls++,key)(req(['Forwarded','spoof']),response);assert.equal(calls,0);assert.equal(response.status,400);
});
test('body deadline destroys incomplete request',async()=>{
  const r=req(),response=res();r.complete=false;
  p.makeRequestListener(()=>{},key,{bodyMs:5,responseMs:25})(r,response);
  await new Promise(resolve=>setTimeout(resolve,12));assert.equal(r.socket.destroyed,true);assert.equal(response.status,408);response.emit('close');
});
test('response deadline and handler exceptions fail closed',async()=>{
  const r=req(),response=res();p.makeRequestListener(()=>{},key,{bodyMs:20,responseMs:5})(r,response);
  await new Promise(resolve=>setTimeout(resolve,12));assert.equal(response.status,504);assert.equal(r.socket.destroyed,true);response.emit('close');
  const broken=res();p.makeRequestListener(()=>{throw new Error('private');},key)(req(),broken);assert.equal(broken.status,503);assert.ok(!broken.body.includes('private'));
});
function entryHarness(overrides={}) {
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  let instance,prepares=0,clock=0,scheduled=0,closes=0;
  const timers=new Map(),exits=[];
  function setTimer(callback,delay){const id=++scheduled;timers.set(id,{at:clock+delay,callback});return id;}
  function clearTimer(id){timers.delete(id);}
  function advance(ms){clock+=ms;for(const [id,item] of [...timers])if(item.at<=clock){timers.delete(id);item.callback();}}
  class FakeServer extends EventEmitter {
    constructor(options,listener){super();this.options=options;this.listener=listener;instance=this;}
    listen(options,done){this.binding={port:options.port,host:options.host};this.bindSignal=options.signal;this.onListen?.();done();}
    close(done){this.closed=true;this.closeCalls=(this.closeCalls??0)+1;done();}
    closeAllConnections(){this.connectionsClosed=true;}
  }
  const processMock=new EventEmitter();Object.assign(processMock,{env:{NODE_ENV:'development',FRONTEND_CANONICAL_ORIGIN:'http://localhost:3002',BACKEND_INTERNAL_ORIGIN:'http://127.0.0.1:3001',...overrides},exitCode:undefined,exit(status){exits.push(status);}});
  const app={async prepare(){prepares++;},getRequestHandler(){return ()=>{};},async close(){closes++;}};
  const module={exports:{}};
  const fakeRequire=name=> {
    if(name==='node:path')return path;
    if(name==='node:crypto')return {randomBytes:()=>Buffer.alloc(32,1)};
    if(name==='node:http')return {Server:FakeServer};
    if(name==='./ingress-policy.cjs')return p;
    if(name==='next')return ()=>app;
    throw new Error('UNEXPECTED_IMPORT');
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../server/local-ingress.cjs'),'utf8'),{require:fakeRequire,module,__dirname:path.join(__dirname,'../server'),process:processMock,AbortController,console:{error(){throw new Error('UNEXPECTED_LOG');}},setTimeout:setTimer,clearTimeout:clearTimer});
  return {main:module.exports.main,processMock,app,FakeServer,exits,advance,timers,
    getInstance:()=>instance,getPrepares:()=>prepares,getCloses:()=>closes,getScheduled:()=>scheduled};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('entry import inert, mocked main binds only loopback with strict parser and header deadlines',async()=>{
  const h=entryHarness();assert.equal(h.getInstance(),undefined);assert.equal(h.getPrepares(),0);
  await h.main();const server=h.getInstance();assert.deepEqual(server.binding,{port:3002,host:'127.0.0.1'});
  assert.equal(server.options.insecureHTTPParser,false);assert.equal(server.options.maxHeaderSize,16384);
  assert.equal(server.options.headersTimeout,5000);assert.equal(server.options.requestTimeout,15000);assert.equal(server.maxHeadersCount,0);
  assert.equal(h.processMock.env.NUUDEL_LOCAL_INGRESS_MODE,'development-v1');assert.match(h.processMock.env.NUUDEL_LOCAL_INGRESS_KEY,/^[a-f0-9]{64}$/);
});
test('production or invalid configuration cannot prepare Next or bind',async()=>{
  for(const fields of [{NODE_ENV:'production'},{FRONTEND_CANONICAL_ORIGIN:'http://evil.test'},{BACKEND_INTERNAL_ORIGIN:undefined}]) {
    const h=entryHarness(fields);await assert.rejects(h.main(),/LOCAL_CONFIGURATION_REQUIRED/);assert.equal(h.getPrepares(),0);assert.equal(h.getInstance(),undefined);
  }
});
test('shutdown during prepare waits to close initialized app and never creates listener',async()=>{
  const h=entryHarness();let release;h.app.prepare=()=>new Promise(resolve=>{release=resolve;});
  const started=h.main();h.processMock.emit('SIGINT');await tick();assert.equal(h.getCloses(),0);assert.deepEqual(h.exits,[]);
  release();await started;await tick();assert.equal(h.getInstance(),undefined);assert.equal(h.getCloses(),1);assert.deepEqual(h.exits,[130]);
});
test('mocked normal shutdown closes owned server then explicitly exits before deadline',async()=>{
  const h=entryHarness();await h.main();h.processMock.emit('SIGTERM');await tick();
  assert.equal(h.getInstance().closed,true);assert.equal(h.getInstance().connectionsClosed,true);assert.equal(h.getCloses(),1);
  assert.deepEqual(h.exits,[143]);assert.equal(h.timers.size,1);h.advance(5000);assert.deepEqual(h.exits,[143]);
});
test('unknown Fetch Metadata and non-HTTP Origin rejected',()=>{
  assert.equal(p.validateIncoming(req(['Sec-Fetch-Unreviewed','x'])),'INVALID_FETCH_METADATA');
  assert.equal(p.validateIncoming(req(['Origin','ftp://example.test'])),'INVALID_ORIGIN');
});
test('64-field policy is not silently truncated and exact body ceiling accepted',()=>{
  const fields=[];for(let i=0;i<64;i++)fields.push('X-Test-'+i,'x');
  assert.equal(p.validateIncoming(req(fields)),'HEADERS_TOO_LARGE');
  assert.equal(p.validateIncoming(req(['Origin','http://localhost:3002','Content-Length','16384'],'POST','/api/register')),null);
});
test('launch replaces supplied private key and shutdown uses nonzero signal status',async()=>{
  const h=entryHarness({NUUDEL_LOCAL_INGRESS_KEY:'c'.repeat(64)});await h.main();
  assert.notEqual(h.processMock.env.NUUDEL_LOCAL_INGRESS_KEY,'c'.repeat(64));
  h.processMock.emit('SIGINT');await tick();assert.equal(h.processMock.exitCode,130);assert.deepEqual(h.exits,[130]);
});
test('preparation that never resolves cannot defeat the shutdown deadline',async()=>{
  const h=entryHarness();h.app.prepare=()=>new Promise(()=>{});void h.main();
  h.processMock.emit('SIGINT');await tick();assert.equal(h.getCloses(),0);
  h.advance(4999);assert.deepEqual(h.exits,[]);h.advance(1);assert.deepEqual(h.exits,[1]);assert.equal(h.getInstance(),undefined);
});
test('cleanup rejection preserves fallback and still attempts remaining cleanup',async()=>{
  const h=entryHarness();await h.main();h.app.close=async()=>{throw new Error('synthetic');};
  h.processMock.emit('SIGTERM');await tick();assert.equal(h.getInstance().closed,true);assert.equal(h.getInstance().connectionsClosed,true);
  assert.deepEqual(h.exits,[]);assert.equal(h.timers.size,1);h.advance(5000);assert.deepEqual(h.exits,[1]);
});
test('hanging cleanup preserves fallback independently of app.close',async()=>{
  const h=entryHarness();await h.main();h.app.close=()=>new Promise(()=>{});
  h.processMock.emit('SIGINT');await tick();assert.equal(h.getInstance().closed,true);
  h.advance(5000);assert.deepEqual(h.exits,[1]);
});
test('hanging server close also cannot defeat deadline',async()=>{
  const h=entryHarness();await h.main();h.getInstance().close=()=>{};
  h.processMock.emit('SIGTERM');await tick();assert.equal(h.getCloses(),1);assert.equal(h.getInstance().connectionsClosed,true);
  assert.deepEqual(h.exits,[]);h.advance(5000);assert.deepEqual(h.exits,[1]);
});
test('synchronous close failures do not skip app or connection cleanup',async()=>{
  const h=entryHarness();await h.main();h.getInstance().close=()=>{throw new Error('close');};
  h.processMock.emit('SIGINT');await tick();assert.equal(h.getCloses(),1);assert.equal(h.getInstance().connectionsClosed,true);
  h.advance(5000);assert.deepEqual(h.exits,[1]);
});
test('repeated signals neither restart cleanup nor extend the first deadline',async()=>{
  const h=entryHarness();await h.main();h.app.close=()=>new Promise(()=>{});
  h.processMock.emit('SIGINT');await tick();h.advance(2500);
  h.processMock.emit('SIGINT');h.processMock.emit('SIGTERM');await tick();
  assert.equal(h.getScheduled(),1);assert.equal(h.getInstance().closeCalls,1);
  h.advance(2500);assert.deepEqual(h.exits,[1]);
});
test('late prepare completion after fallback never creates a listener',async()=>{
  const h=entryHarness();let release;h.app.prepare=()=>new Promise(resolve=>{release=resolve;});
  const pending=h.main();h.processMock.emit('SIGINT');h.advance(5000);assert.deepEqual(h.exits,[1]);
  release();await pending;await tick();assert.equal(h.getInstance(),undefined);assert.deepEqual(h.exits,[1]);
});
test('successful cleanup just before deadline explicitly exits once',async()=>{
  const h=entryHarness();await h.main();let release;h.app.close=()=>new Promise(resolve=>{release=resolve;});
  h.processMock.emit('SIGTERM');await tick();h.advance(4999);assert.deepEqual(h.exits,[]);
  release();await tick();assert.deepEqual(h.exits,[143]);assert.equal(h.timers.size,1);
  h.advance(1);assert.deepEqual(h.exits,[143]);
});
test('prepare rejection is handled and triggers process-level exit without a listener',async()=>{
  const h=entryHarness();h.app.prepare=async()=>{throw new Error('synthetic');};
  await h.main();await tick();assert.equal(h.getInstance(),undefined);assert.equal(h.getCloses(),1);assert.deepEqual(h.exits,[1]);
});
test('listen failure triggers owned cleanup without unhandled rejection',async()=>{
  const h=entryHarness();h.FakeServer.prototype.listen=function(){this.emit('error',new Error('synthetic'));};
  await h.main();await tick();assert.equal(h.getInstance().closed,true);assert.equal(h.getCloses(),1);assert.deepEqual(h.exits,[1]);
});
test('cancellation during binding aborts pending listen and never resumes startup',async()=>{
  const h=entryHarness();let bound;
  h.FakeServer.prototype.listen=function(options,done){this.binding={port:options.port,host:options.host};this.bindSignal=options.signal;bound=done;h.processMock.emit('SIGINT');};
  await h.main();await tick();assert.equal(h.getInstance().bindSignal.aborted,true);assert.deepEqual(h.exits,[130]);
  bound();await tick();assert.deepEqual(h.exits,[130]);
});

const PROOF_NOW=1700000000000;
function signedPost(body='{"x":1}') {
  const incoming=req(['Origin','http://localhost:3002','Content-Type','application/json','Content-Length',String(Buffer.byteLength(body)),'Cookie','synthetic=value'],'POST','/api/register?source=mock');
  p.sealIncoming(incoming,key,PROOF_NOW);
  return new Request('http://localhost:3002'+incoming.url,{method:incoming.method,headers:incoming.headers,body});
}
for(const [name,value] of [['origin','https://example.invalid'],['content-type','text/plain'],['cookie','synthetic=changed']]) {
  test('HMAC rejects '+name+' substitution',()=>{
    const request=signedPost();assert.equal(p.verifyProof(request,key,PROOF_NOW),true);
    request.headers.set(name,value);assert.equal(p.verifyProof(request,key,PROOF_NOW),false);
  });
}
test('HMAC rejects method substitution',()=>{
  const original=signedPost();const changed=new Request(original.url,{method:'PUT',headers:original.headers,body:'{"x":1}'});
  assert.equal(p.verifyProof(changed,key,PROOF_NOW),false);
});
test('HMAC rejects query substitution',()=>{
  const original=signedPost();const changed=new Request(original.url+'&extra=1',{method:'POST',headers:original.headers,body:'{"x":1}'});
  assert.equal(p.verifyProof(changed,key,PROOF_NOW),false);
});
for(const [label,mutate] of [['truncated',s=>s.slice(0,-1)],['oversized',s=>s+'a'],['invalid hexadecimal',s=>s.slice(0,-1)+'g']]) {
  test('HMAC rejects '+label+' proof without throwing',()=>{
    const request=signedPost();request.headers.set(p.MARKER,mutate(request.headers.get(p.MARKER)));
    assert.equal(p.verifyProof(request,key,PROOF_NOW),false);
  });
}
test('HMAC rejects future-dated proof and has an exact 60-second lifetime',()=>{
  const request=signedPost();assert.equal(p.verifyProof(request,key,PROOF_NOW-1),false);
  assert.equal(p.verifyProof(request,key,PROOF_NOW+60000),true);assert.equal(p.verifyProof(request,key,PROOF_NOW+60001),false);
});
test('documented limitation: identical proof is reusable within lifetime',()=>{
  const request=signedPost();assert.equal(p.verifyProof(request,key,PROOF_NOW),true);assert.equal(p.verifyProof(request,key,PROOF_NOW+1),true);
});
test('documented limitation: same-length body substitution is not detected by HMAC',async()=>{
  const original=signedPost();const changed=new Request(original.url,{method:'POST',headers:original.headers,body:'{"x":2}'});
  const a=await original.clone().text(),b=await changed.clone().text();assert.notEqual(a,b);assert.equal(Buffer.byteLength(a),Buffer.byteLength(b));
  assert.equal(p.verifyProof(original,key,PROOF_NOW),true);assert.equal(p.verifyProof(changed,key,PROOF_NOW),true);
});
test('ERR_SERVER_NOT_RUNNING close callback preserves fallback',async()=>{
  const h=entryHarness();await h.main();h.getInstance().close=done=>done(Object.assign(new Error('synthetic'),{code:'ERR_SERVER_NOT_RUNNING'}));
  h.processMock.emit('SIGTERM');await tick();assert.equal(h.getCloses(),1);assert.deepEqual(h.exits,[]);
  h.advance(5000);assert.deepEqual(h.exits,[1]);
});
test('delayed binding callback after cancellation cannot resume RUNNING',async()=>{
  const h=entryHarness();let finish;
  h.FakeServer.prototype.listen=function(options,done){this.bindSignal=options.signal;finish=done;};
  const pending=h.main();await tick();h.processMock.emit('SIGINT');await pending;await tick();
  assert.equal(h.getInstance().bindSignal.aborted,true);assert.deepEqual(h.exits,[130]);
  finish();await tick();assert.deepEqual(h.exits,[130]);
});
test('closeAllConnections throw cannot skip app.close or disarm fallback',async()=>{
  const h=entryHarness();await h.main();h.getInstance().closeAllConnections=()=>{throw new Error('synthetic');};
  h.processMock.emit('SIGINT');await tick();assert.equal(h.getCloses(),1);assert.deepEqual(h.exits,[]);
  h.advance(5000);assert.deepEqual(h.exits,[1]);
});
test('late server error starts bounded owned shutdown',async()=>{
  const h=entryHarness();await h.main();h.getInstance().emit('error',new Error('synthetic'));
  await tick();assert.equal(h.getInstance().closed,true);assert.equal(h.getCloses(),1);assert.deepEqual(h.exits,[1]);
});
