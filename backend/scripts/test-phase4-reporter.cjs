const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const Reporter=require('./phase4-reporter.cjs');
const budgets=require('./phase4-budgets.cjs');
test('sanitized categories preserve SQLSTATE without error values',()=>{
 for(const [error,category,state] of [
 [{name:'AssertionError',message:'PASSWORD_SECRET'},'ASSERTION_FAILED',null],
 [{code:'P2010',meta:{code:'23505'},message:'postgresql://SECRET'},'DATABASE_CONSTRAINT','23505'],
 [{code:'P2002'},'DATABASE_CONSTRAINT',null],
 [{code:'40P01'},'DEADLOCK','40P01'],[{code:'55P03'},'LOCK_TIMEOUT','55P03'],
 [{code:'40001'},'SERIALIZATION_CONFLICT','40001'],[{message:'Test timed out SECRET'},'TEST_TIMEOUT',null],
 [{message:'Hook timed out SECRET'},'HOOK_TIMEOUT',null],[{code:'P2028'},'PRISMA_TRANSACTION_EXPIRED',null]
 ]) assert.deepEqual(Reporter.classify([error]),{category,sqlstate:state});
});
test('reporter stores only registered names and safe fields',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'phase4-reporter-test-'));const file=path.join(dir,'safe.jsonl');
 fs.writeFileSync(file,'',{mode:0o600});process.env.PHASE4_DIAGNOSTICS_PATH=file;
 try{const r=new Reporter();r.onTestRunStart();
 const t={name:'SECRET_API_KEY',result:()=>({state:'failed',errors:[{name:'AssertionError',message:'postgresql://SECRET',actual:'SECRET'}]}),diagnostic:()=>({duration:123})};
 r.onTestCaseReady(t);r.onTestCaseResult(t);r.onTestRunEnd([],[],'failed');
 const content=fs.readFileSync(file,'utf8');assert.ok(!content.includes('SECRET'));const rows=content.trim().split('\n').map(JSON.parse);
 assert.equal(rows[1].test_id,'UNKNOWN_TEST');assert.equal(rows[2].category,'ASSERTION_FAILED');assert.equal(rows[2].duration_ms,123);
 }finally{delete process.env.PHASE4_DIAGNOSTICS_PATH;fs.rmSync(dir,{recursive:true});}
});
test('timeouts leave room for directed lock waiter and transport',()=>{
 assert.ok(budgets.winnerTransaction+budgets.barrier<budgets.lock);
 assert.ok(budgets.lock<budgets.statement);assert.ok(budgets.statement<90000);
 assert.ok(2*budgets.winnerTransaction+budgets.barrier<budgets.waiterTransaction);
 assert.ok(budgets.waiterTransaction+budgets.pool<budgets.test);
});
test('real Vitest hooks retain failed name and duration for a local assertion only',()=>{
 const {spawnSync}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'phase4-vitest-mock-'));const file=path.join(dir,'safe.jsonl');
 try{
 fs.writeFileSync(file,'',{mode:0o600});
 const name=Object.values(Reporter.names)[0];
 fs.writeFileSync(path.join(dir,'mock.test.mjs'),`import {test,expect} from ${JSON.stringify(path.resolve(__dirname,'../node_modules/vitest/dist/index.js'))}; test(${JSON.stringify(name)},()=>{console.log('SECRET_SENTINEL');expect('SECRET_SENTINEL').toBe('different');});`);
 fs.writeFileSync(path.join(dir,'config.mjs'),`export default {test:{root:${JSON.stringify(dir)},include:['mock.test.mjs'],reporters:[${JSON.stringify(path.join(__dirname,'phase4-reporter.cjs'))}],silent:true,retry:0,bail:1,maxWorkers:1,cache:false}};`);
 const result=spawnSync(process.execPath,[path.resolve(__dirname,'../node_modules/vitest/vitest.mjs'),'run','--config',path.join(dir,'config.mjs')],{encoding:'utf8',timeout:30000,env:{PATH:process.env.PATH,HOME:process.env.HOME,PHASE4_DIAGNOSTICS_PATH:file}});
 assert.equal(result.status,1);const content=fs.readFileSync(file,'utf8');assert.ok(!content.includes('SECRET_SENTINEL'));
 const rows=content.trim().split('\n').map(JSON.parse);const failure=rows.find(r=>r.event==='case_result');
 assert.ok(failure,'reporter must emit case result');assert.equal(failure.test_id,'P4-N01');assert.equal(failure.category,'ASSERTION_FAILED');assert.equal(typeof failure.duration_ms,'number');
 }finally{fs.rmSync(dir,{recursive:true});}
});
test('structured Prisma codes are retained without raw metadata',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'phase4-code-test-'));const file=path.join(dir,'safe.jsonl');
 fs.writeFileSync(file,'',{mode:0o600});process.env.PHASE4_DIAGNOSTICS_PATH=file;
 try{
  const reporter=new Reporter();reporter.onTestCaseResult({name:Object.values(Reporter.names)[1],result:()=>({state:'failed',errors:[{code:'P2002',message:'SECRET',meta:{target:['SECRET']}}]}),diagnostic:()=>({duration:15})});
  const row=JSON.parse(fs.readFileSync(file,'utf8'));assert.deepEqual(row.prisma_codes,['P2002']);assert.equal(row.category,'DATABASE_CONSTRAINT');assert.equal(row.sqlstate,null);assert.ok(!JSON.stringify(row).includes('SECRET'));
 }finally{delete process.env.PHASE4_DIAGNOSTICS_PATH;fs.rmSync(dir,{recursive:true});}
});
