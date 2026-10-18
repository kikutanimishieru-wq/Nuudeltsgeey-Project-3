const {test}=require('node:test');const assert=require('node:assert/strict');
const check=require('./phase4-duplicate-check.cjs');
const marker='DUPLICATE_TOURNAMENT_PARTICIPATION';
test('legacy message and trigger contexts without verified DETAIL are rejected',()=>{
 for(const error of [{code:'23505',message:marker},{code:'P2002',message:marker},{code:'P2010',meta:{code:'23505',message:marker}}, {code:'23505',where:'PL/pgSQL function enforce_phase4_entrant_invariants() line 30'}])
  assert.equal(check.expectedRejection(check.facts(error)),false);
});
test('generic P2002, unrelated constraints and arbitrary 23505 fail closed',()=>{
 for(const error of [{code:'P2002'},{code:'23505'},{code:'P2002',meta:{target:['email']}},{code:'P2002',message:marker,meta:{target:['id']}},{code:'23505',message:marker,constraint:'unrelated_pkey'},{code:'P2002',cause:{code:'ECONNRESET'},message:marker}])
  assert.equal(check.expectedRejection(check.facts(error)),false);
});
test('timeouts deadlocks connectivity and serialization never qualify as duplicate',()=>{
 for(const code of ['40P01','55P03','57014','40001','P2028','P2034','P1001','P1002','P1008','P1017','08006','08001','23503','23514','99999'])
  assert.equal(check.expectedRejection(check.facts({code:'P2010',meta:{code:'23505',message:require('./phase4-duplicate-sql.cjs').detailToken},cause:{code}})),false,code);
});
test('postconditions reject duplicate rows, partial registrations and wrong winner',()=>{
 const p={registration_count:1,roster_count:1,duplicate_count:0,winner_team_valid:true,shared_player_only:true};
 assert.equal(check.validPostconditions(p),true);
 for(const delta of [{registration_count:2},{roster_count:2},{duplicate_count:1},{winner_team_valid:false},{shared_player_only:false},{registration_count:0}])assert.equal(check.validPostconditions({...p,...delta}),false);
});
test('diagnostics redact all unrecognized values and preserve session/outcome evidence',()=>{
 const row=check.safeStage('TRANSACTION_OUTCOMES',{session_ids:[123,456],outcomes:['fulfilled','rejected'],rejections:[{...check.facts({code:'P2002',message:marker}),secret:'SECRET_PASSWORD'}],message:'SECRET_URL'});
 assert.deepEqual(row.session_ids,[123,456]);assert.equal(row.rejections[0].prisma_codes[0],'P2002');assert.ok(!JSON.stringify(row).includes('SECRET'));
 assert.throws(()=>check.safeStage('SECRET_STAGE'));
 const malicious=check.safeStage('ONE_COMMIT',{session_ids:['SECRET'],rejections:[{prisma_codes:['SECRET'],sqlstates:['SECRET'],rejection_context:'SECRET'}]});assert.ok(!JSON.stringify(malicious).includes('SECRET'));
});
test('Prisma P2010 exposes SQLSTATE but a message-only 23505 loses attribution',()=>{
 const e={code:'P2010',meta:{code:'23505',message:'Unique constraint failed: (not available)'}};
 const observed=check.facts(e);
 assert.equal(observed.rejection_context,'UNATTRIBUTED');
 assert.deepEqual(observed.prisma_codes,['P2010']);assert.deepEqual(observed.sqlstates,['23505']);
 assert.equal(check.expectedRejection(observed),false);
});
test('exact preserved DETAIL attributes P2010 and rejects missing or unrelated context',()=>{
 const {detailToken}=require('./phase4-duplicate-sql.cjs');
 const make=message=>({code:'P2010',meta:{code:'23505',message}});
 assert.equal(check.expectedRejection(check.facts(make(detailToken))),true);
 assert.equal(check.facts(make(detailToken)).rejection_context,'VERIFIED_DUPLICATE_DETAIL');
 for(const message of [undefined,'N/A','unrelated unique violation',detailToken+' SECRET','prefix '+detailToken])assert.equal(check.expectedRejection(check.facts(make(message))),false);
 assert.equal(check.expectedRejection(check.facts({code:'P2010',meta:{code:'23505',detail:detailToken}})),true);
 assert.equal(check.expectedRejection(check.facts({code:'P2010',meta:{code:'23505',message:detailToken,constraint:'unrelated_pkey'}})),false);
 for(const code of ['40P01','55P03','57014','40001','08006'])assert.equal(check.expectedRejection(check.facts({code:'P2010',meta:{code,message:detailToken}})),false);
});
test('prepared fixed SQL tags only a checked original trigger exception',()=>{
 const {sql,detailToken}=require('./phase4-duplicate-sql.cjs');
 assert.ok(sql.includes('GET STACKED DIAGNOSTICS'));
 for(const condition of ["error_state = '23505'", "error_message = 'DUPLICATE_TOURNAMENT_PARTICIPATION'", "coalesce(error_constraint, '') = ''", 'error_context ~'])assert.ok(sql.includes(condition));
 assert.ok(sql.includes('enforce_phase4_entrant_invariants'));
 assert.ok(sql.includes(`DETAIL = '${detailToken}'`));assert.match(sql,/ELSE\s+RAISE;/);
 assert.ok(!/CREATE|ALTER|DROP/.test(sql));
});

test('verified DETAIL requires both observed 23505 and a supported Prisma representation',()=>{
 const {detailToken}=require('./phase4-duplicate-sql.cjs');
 for(const code of ['P2010','P2002']) {
  assert.equal(check.expectedRejection(check.facts({code,meta:{code:'23505',message:detailToken}})),true);
  assert.equal(check.expectedRejection(check.facts({code,meta:{code:'23505',detail:detailToken}})),true);
  assert.equal(check.expectedRejection(check.facts({code,meta:{detail:detailToken}})),false);
  assert.equal(check.expectedRejection(check.facts({code,message:detailToken,meta:{code:'23505'}})),false);
  assert.equal(check.expectedRejection(check.facts({code,meta:{code:'23505',userInput:detailToken}})),false);
 }
 assert.equal(check.expectedRejection(check.facts({code:'23505',detail:detailToken})),false);
 assert.equal(check.expectedRejection(check.facts({code:'P2003',meta:{code:'23505',message:detailToken}})),false);
});
test('missing token never qualifies even with duplicate marker or trigger context',()=>{
 for(const code of ['P2010','P2002'])
  for(const context of [{message:marker},{where:'PL/pgSQL function enforce_phase4_entrant_invariants() line 30'}, {detail:'unrelated'}, {}])
   assert.equal(check.expectedRejection(check.facts({code,meta:{code:'23505',...context}})),false);
 for(const rejection_context of ['DUPLICATE_MARKER','PARTICIPATION_TRIGGER','UNATTRIBUTED'])
  assert.equal(check.expectedRejection({unexpected_code:false,prisma_codes:['P2010'],sqlstates:['23505'],rejection_context}),false);
 for(const value of [null,{}, {rejection_context:'VERIFIED_DUPLICATE_DETAIL',unexpected_code:false}])assert.equal(check.expectedRejection(value),false);
});
