// Persist ONLY allowlisted diagnostics. Never serialize Error objects, assertions, values or console output.
const fs = require('node:fs');
const names = require('./phase4-case-names.json');
const {facts} = require('./phase4-duplicate-check.cjs');
const states = new Set(['23505','23514','23503','23502','40001','40P01','55P03','57014','25P02']);
const ids = Object.fromEntries(Object.entries(names).map(([id,name])=>[name,id]));
const categories = new Set(['NONE','ASSERTION_FAILED','DATABASE_CONSTRAINT','SERIALIZATION_CONFLICT','DEADLOCK','LOCK_TIMEOUT','STATEMENT_CANCELLED','DATABASE_ERROR','PRISMA_TRANSACTION_EXPIRED','TLS_ERROR','CONNECTIVITY_ERROR','BARRIER_TIMEOUT','TEST_TIMEOUT','HOOK_TIMEOUT','UNCLASSIFIED_ERROR']);
function classify(errors) {
 let sqlstate=null, prisma=null, assertion=false, timeout=null;
 const visit=(error,depth=0)=>{
  if(!error || typeof error!=='object' || depth>4) return;
  for(const key of ['sqlstate','sqlState','code']) {
   if(states.has(error[key])) sqlstate=error[key];
   if(['P2002','P2034','P2028','P2010','P1011','P1001'].includes(error[key])) prisma=error[key];
  }
  assertion ||= error.name==='AssertionError';
  const message=typeof error.message==='string'?error.message.slice(0,20000):'';
  const match=message.match(/(?:SQLSTATE|\bcode\s*:)\s*["']?([A-Z0-9]{5})\b/i);
  if(match && states.has(match[1])) sqlstate=match[1];
  if(message.includes('BARRIER_TIMEOUT')) timeout='BARRIER_TIMEOUT';
  else if(/hook timed out/i.test(message)) timeout='HOOK_TIMEOUT';
  else if(/test timed out/i.test(message)) timeout='TEST_TIMEOUT';
  for(const key of ['cause','meta','originalError']) visit(error[key],depth+1);
 };
 for(const error of (Array.isArray(errors)?errors:[]).slice(0,32)) visit(error);
 let category=sqlstate==='40001'?'SERIALIZATION_CONFLICT':sqlstate==='40P01'?'DEADLOCK':sqlstate==='55P03'?'LOCK_TIMEOUT':sqlstate==='57014'?'STATEMENT_CANCELLED':sqlstate?.startsWith('23')?'DATABASE_CONSTRAINT':sqlstate?'DATABASE_ERROR':null;
 category ||= timeout || ({P2002:'DATABASE_CONSTRAINT',P2034:'SERIALIZATION_CONFLICT',P2028:'PRISMA_TRANSACTION_EXPIRED',P2010:'DATABASE_ERROR',P1011:'TLS_ERROR',P1001:'CONNECTIVITY_ERROR'}[prisma]) || (assertion?'ASSERTION_FAILED':'UNCLASSIFIED_ERROR');
 return {category,sqlstate};
}
function duration(value) {return Number.isFinite(value)&&value>=0?Math.min(Math.round(value),86400000):null;}
class SafeReporter {
 write(record) {
  const file=process.env.PHASE4_DIAGNOSTICS_PATH;
  if(!file) throw Error('DIAGNOSTIC_PATH_REQUIRED');
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW);
  try {
   const st=fs.fstatSync(fd);
   if(!st.isFile()||st.uid!==process.getuid()||(st.mode&0o077)!==0) throw Error('DIAGNOSTIC_FILE_REJECTED');
   fs.writeSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);
  } finally {fs.closeSync(fd);}
 }
 onTestRunStart(){this.started=Date.now();this.write({event:'run_started'});}
 onTestCaseReady(test){this.write({event:'case_started',test_id:ids[test.name]??'UNKNOWN_TEST',start_ms:Date.now()});}
 onTestCaseResult(test){
  const result=test.result();const state=['passed','failed','skipped','pending'].includes(result.state)?result.state:'pending';
  this.write({event:'case_result',test_id:ids[test.name]??'UNKNOWN_TEST',state,duration_ms:duration(test.diagnostic()?.duration),...(state==='failed'?classify(result.errors):{category:'NONE',sqlstate:null}), prisma_codes:[...new Set((result.errors??[]).flatMap(error=>facts(error).prisma_codes))]});
 }
 onTestRunEnd(modules,errors,reason){
  const all=[...(errors??[])];
  for(const module of modules??[]) if(typeof module.errors==='function') all.push(...module.errors());
  this.write({event:'run_end',state:reason==='passed'?'passed':'failed',duration_ms:duration(Date.now()-this.started),...(all.length?classify(all):{category:reason==='passed'?'NONE':'UNCLASSIFIED_ERROR',sqlstate:null})});
 }
 // Ignore all user console messages, including ones containing assertion/fixture data.
 onUserConsoleLog(){}
}
module.exports=SafeReporter;
module.exports.classify=classify;
module.exports.names=names;
module.exports.categories=categories;
module.exports.states=states;
