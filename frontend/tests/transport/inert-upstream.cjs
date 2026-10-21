'use strict';
// Only fixed synthetic behavior. Importing does not load http or bind sockets.
const {createHash}=require('node:crypto');
const SCENARIOS=new Set(['json','session','query','cookies','login','logout','safe_redirect','unsafe_redirect','timeout','reject_stream','disconnect','network_failure','overflow']);
const MAX_RECORDS=256;
function createEngine(publish) {
  let active=null,counts=new Map(),stopped=false,records=0,inflight=0,total=0;
  const emit=(code,extra={})=>{
    if(++records>MAX_RECORDS){stopped=true;throw new Error('UPSTREAM_EVIDENCE_LIMIT');}
    try {publish({code,...extra});} catch(error) {stopped=true;throw error;}
  };
  function arm(caseSpec) {
    if(stopped || active || !/^[a-z0-9-]{1,64}$/.test(caseSpec.id) || !SCENARIOS.has(caseSpec.scenario)
      || ![0,1].includes(caseSpec.expected.upstream_requests) || counts.has(caseSpec.id)) throw new Error('INVALID_CASE_ARM');
    active=JSON.parse(JSON.stringify(caseSpec));counts.set(active.id,0);
  }
  function finish() {
    if(stopped || !active || inflight!==0 || counts.get(active.id)!==active.expected.upstream_requests)throw new Error('CASE_INCOMPLETE');
    const result={case:active.id,count:counts.get(active.id)};active=null;return result;
  }
  function handle(req,res) {
    if(stopped || !active){stopped=true;req.socket.destroy();emit('UNARMED_REQUEST');return;}
    const spec=active;
    const cookies=(req.headers.cookie??'').split(';').map(x=>x.trim());
    if(cookies.filter(x=>x.startsWith('transport-case=')).length!==1 || !cookies.includes('transport-case='+spec.id)) {
      stopped=true;req.socket.destroy();emit('CASE_ATTRIBUTION_FAILED');return;
    }
    total++;
    counts.set(spec.id,counts.get(spec.id)+1);
    if(counts.get(spec.id)>spec.expected.upstream_requests || req.method!==spec.request.method || req.url!==spec.request.target){
      stopped=true;req.socket.destroy();emit('UNEXPECTED_REQUEST',{case:spec.id});return;
    }
    const targetDigest=createHash('sha256').update(req.url).digest('hex');
    inflight++;
    let bytes=0;
    req.on('data',chunk=>{bytes+=chunk.length;if(bytes>16384){stopped=true;req.socket.destroy();emit('BODY_LIMIT',{case:spec.id});}});
    req.on('error',()=>{stopped=true;emit('REQUEST_ERROR',{case:spec.id});});
    let completed=false;
    const complete=cancelled=>{if(completed)return;completed=true;inflight--;emit(cancelled?'CANCELLED':'RESPONSE_FINISHED',{case:spec.id});};
    res.on('finish',()=>complete(false));
    res.on('close',()=>complete(true));
    req.on('end',()=>{
      if(stopped || completed)return;
      const json=payload=>{res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(payload));};
      const s=spec.scenario;
      if(s==='network_failure'){req.socket.destroy();return;}
      if(s==='timeout')return;
      if(s==='reject_stream'){res.writeHead(307,{location:'https://example.invalid/not-followed'});res.flushHeaders();return;}
      // Controller waits for REQUEST_RECEIVED over owned IPC, never a buffered HTTP ACK.
      if(s==='disconnect')return;
      if(s==='overflow'){res.writeHead(200,{'content-type':'application/json'});res.write('x'.repeat(2097153));return;}
      if(s==='safe_redirect' || s==='unsafe_redirect'){
        res.writeHead(307,{location:s==='safe_redirect'?'http://localhost:3002/identity':'https://example.invalid/not-followed'});res.end();return;
      }
      if(s==='cookies')res.setHeader('set-cookie',[
        'authjs.session-token.0=synthetic-a; Path=/; HttpOnly; SameSite=Lax',
        'authjs.session-token.1=synthetic-b; Path=/; HttpOnly; SameSite=Lax',
        'identity-steam=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly']);
      if(s==='login'){res.setHeader('set-cookie','synthetic-session=mock; Path=/; HttpOnly; SameSite=Lax');json({status:'SIGNED_IN',synthetic:true});return;}
      if(s==='logout'){res.setHeader('set-cookie','synthetic-session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');json({status:'SIGNED_OUT',synthetic:true});return;}
      if(s==='session'){
        const signed=(req.headers.cookie??'').split(';').some(x=>x.trim()==='synthetic-session=mock');
        json({synthetic:true,user:signed?{id:'mock-player',publicNmdId:'NMD-000000'}:null});return;
      }
      json({synthetic:true,target_exact:true});
    });
    // Install all completion observers before publishing the out-of-band barrier.
    emit('REQUEST_RECEIVED',{case:spec.id,target_sha256:targetDigest,target_exact:true});
  }
  return {arm,finish,handle,stopped:()=>stopped,inventory:()=>({total,counts:Object.fromEntries(counts),inflight})};
}
function startReviewedServer(http,engine) {
  // Future reviewed launcher only. Tests inject a fake HTTP implementation.
  const server=http.createServer({insecureHTTPParser:false,maxHeaderSize:16384,headersTimeout:5000,requestTimeout:15000},engine.handle);
  server.maxConnections=4;server.maxHeadersCount=64;
  server.on('clientError',(_error,socket)=>socket.destroy());
  server.on('upgrade',(_req,socket)=>socket.destroy());
  server.on('connect',(_req,socket)=>socket.destroy());
  server.listen(3001,'127.0.0.1');return server;
}
if(require.main===module){
  // A '--execute' flag cannot bypass the missing reviewed process/IPC adapter.
  console.error('BLOCKED: UPSTREAM_PROCESS_LAUNCH_ADAPTER_UNVERIFIED');process.exitCode=2;
}
module.exports={createEngine,startReviewedServer};
