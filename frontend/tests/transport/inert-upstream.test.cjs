'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {createEngine,startReviewedServer}=require('./inert-upstream.cjs');const cases=require('./cases.json').cases;
function request(spec,cookie='transport-case='+spec.id){
 const req=new EventEmitter();Object.assign(req,{method:spec.request.method,url:spec.request.target,headers:{cookie},socket:{destroy(){this.destroyed=true;}}});
 const res=new EventEmitter();res.headers={};res.setHeader=(n,v)=>res.headers[n]=v;res.writeHead=(s,h)=>{res.status=s;Object.assign(res.headers,h);};res.end=v=>{res.body=v;res.emit('finish');};res.flushHeaders=()=>res.flushed=true;res.write=v=>res.body=v;
 return {req,res};
}
function fixture(id){const records=[];const engine=createEngine(r=>records.push(r));const spec=cases.find(x=>x.id===id);engine.arm(spec);return {records,engine,spec,...request(spec)};}
for(const id of ['handoff','query','cookies','login','session','logout','post-logout-session','safe-redirect','unsafe-redirect','timeout','reject-stream','disconnect','network-failure','response-overflow']){
 test('completion-aware synthetic scenario '+id,()=>{
  const f=fixture(id);if(id==='session')f.req.headers.cookie+='; synthetic-session=mock';
  f.engine.handle(f.req,f.res);f.req.emit('end');
  if(['timeout','reject-stream','disconnect','network-failure','response-overflow'].includes(id)){
   assert.throws(()=>f.engine.finish(),/INCOMPLETE/);f.res.emit('close');assert.equal(f.records.at(-1).code,'CANCELLED');
  }
  assert.equal(f.engine.finish().count,1);assert.equal(f.records[0].code,'REQUEST_RECEIVED');
  assert.ok(!JSON.stringify(f.records).includes('synthetic-session=mock'));
  if(id==='cookies')assert.equal(f.res.headers['set-cookie'].length,3);
  if(id==='session')assert.equal(JSON.parse(f.res.body).user.id,'mock-player');
  if(id==='post-logout-session')assert.equal(JSON.parse(f.res.body).user,null);
  if(id==='disconnect'){assert.equal(f.res.body,undefined);assert.equal(f.records[0].case,'disconnect');}
 });
}
test('late previous case cannot be attributed to next case',()=>{
 const f=fixture('handoff');f.engine.handle(f.req,f.res);f.req.emit('end');f.engine.finish();
 const next=cases.find(x=>x.id==='session');f.engine.arm(next);const late=request(f.spec);f.engine.handle(late.req,late.res);
 assert.equal(f.engine.stopped(),true);assert.equal(f.engine.inventory().counts.session,0);assert.throws(()=>f.engine.finish());
});
test('counters persist and completed cases cannot be rearmed',()=>{
 const f=fixture('handoff');f.engine.handle(f.req,f.res);f.req.emit('end');f.engine.finish();assert.throws(()=>f.engine.arm(f.spec));assert.equal(f.engine.inventory().counts.handoff,1);
});
test('unexpected requests permanently stop experiment',()=>{const f=fixture('forged-proof');f.engine.handle(f.req,f.res);assert.equal(f.engine.stopped(),true);assert.throws(()=>f.engine.finish());assert.throws(()=>f.engine.arm(cases[0]));});
test('publication failure stops engine',()=>{const engine=createEngine(()=>{throw Error('disk');});const spec=cases[0];engine.arm(spec);const f=request(spec);assert.throws(()=>engine.handle(f.req,f.res));assert.equal(engine.stopped(),true);assert.throws(()=>engine.finish());});
test('completion waits for response finish, not end invocation',()=>{const f=fixture('handoff');f.res.end=()=>{};f.engine.handle(f.req,f.res);f.req.emit('end');assert.throws(()=>f.engine.finish());f.res.emit('finish');assert.equal(f.engine.finish().count,1);});
test('wrong correlation, method or target rejected',()=>{
 for(const kind of ['cookie','method','target']){const f=fixture('handoff');if(kind==='cookie')f.req.headers.cookie='transport-case=other';if(kind==='method')f.req.method='POST';if(kind==='target')f.req.url='/wrong';f.engine.handle(f.req,f.res);assert.equal(f.engine.stopped(),true);assert.throws(()=>f.engine.finish());}
});
test('oversize inbound body stops experiment',()=>{const f=fixture('login');f.engine.handle(f.req,f.res);f.req.emit('data',Buffer.alloc(16385));assert.equal(f.engine.stopped(),true);});
test('arm uses snapshot not caller-owned case object',()=>{const records=[];const e=createEngine(r=>records.push(r));const c=JSON.parse(JSON.stringify(cases[0]));e.arm(c);c.request.target='/changed';const f=request(cases[0]);e.handle(f.req,f.res);f.req.emit('end');assert.equal(e.finish().count,1);});
test('server factory uses fake HTTP only',()=>{const calls=[];const server=new EventEmitter();server.listen=(...a)=>calls.push(a);startReviewedServer({createServer(options,handler){assert.equal(options.insecureHTTPParser,false);return server;}},createEngine(()=>{}));assert.deepEqual(calls,[[3001,'127.0.0.1']]);});
