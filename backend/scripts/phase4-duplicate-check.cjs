// Pure validation and allowlisted diagnostics; no database client or connection.
const contract=require('./phase4-duplicate-contract.json');
const {detailToken}=require('./phase4-duplicate-sql.cjs');
function facts(error) {
 const prisma=new Set(), sql=new Set();let verifiedDetail=false,marker=false,trigger=false,otherConstraint=false,unexpectedCode=false;
 const visit=(e,depth=0,rawMeta=false)=>{
  if(!e||typeof e!=='object'||depth>4)return;
  for(const k of ['code','sqlstate','sqlState','originalCode']){
   if(contract.prisma_codes.includes(e[k]))prisma.add(e[k]);
   if(contract.sqlstates.includes(e[k]))sql.add(e[k]);
   if(e[k]!=null && !contract.prisma_codes.includes(e[k]) && !contract.sqlstates.includes(e[k]))unexpectedCode=true;
  }
  if(e.constraint || e.constraint_name || (e.target!=null && (!Array.isArray(e.target)||e.target.length)))otherConstraint=true;
  // Inspect only bounded text; emit a fixed context token, never the text itself.
  const message=typeof e.message==='string'?e.message.slice(0,20000):'';
  marker ||= /\bDUPLICATE_TOURNAMENT_PARTICIPATION\b/.test(message);
  // Engine raw-query metadata carries the original DETAIL as meta.message.
  const pgUnique=['code','sqlstate','sqlState','originalCode'].some(k=>e[k]==='23505');
  verifiedDetail ||= pgUnique && (e.detail === detailToken || (rawMeta && message === detailToken));
  const where=typeof e.where==='string'?e.where.slice(0,20000):'';
  trigger ||= /\bfunction (?:public\.)?"?enforce_phase4_entrant_invariants"?\(/.test(where);
  for(const k of ['meta','cause','originalError'])visit(e[k],depth+1,k==='meta');
 };
 visit(error);
 return {unexpected_code:unexpectedCode,prisma_codes:[...prisma].sort(),sqlstates:[...sql].sort(),rejection_context:otherConstraint?'UNEXPECTED_CONSTRAINT':verifiedDetail?'VERIFIED_DUPLICATE_DETAIL':marker?'DUPLICATE_MARKER':trigger?'PARTICIPATION_TRIGGER':'UNATTRIBUTED'};
}
function expectedRejection(value) {
 // Context-only fallbacks are retained for diagnostics, never for acceptance.
 return !!value && value.unexpected_code===false && value.rejection_context==='VERIFIED_DUPLICATE_DETAIL'
  && Array.isArray(value.prisma_codes) && value.prisma_codes.length===1
  && ['P2002','P2010'].includes(value.prisma_codes[0])
  && Array.isArray(value.sqlstates) && value.sqlstates.length===1 && value.sqlstates[0]==='23505';
}
function validPostconditions(p) {
 return p.registration_count===1 && p.roster_count===1 && p.duplicate_count===0
  && p.winner_team_valid===true && p.shared_player_only===true;
}
function safeStage(stage,detail={}){
 if(!contract.stages.includes(stage))throw Error('INVALID_DIAGNOSTIC_STAGE');
 const out={event:'duplicate_stage',test_id:'P4-N02',assertion_stage:stage};
 for(const key of ['fixture_valid','trigger_verified','distinct_sessions','winner_team_valid','shared_player_only'])
  if(typeof detail[key]==='boolean')out[key]=detail[key];
 for(const key of ['registration_count','roster_count','duplicate_count','fulfilled_count','rejected_count'])
  if(Number.isInteger(detail[key])&&detail[key]>=0&&detail[key]<=10000)out[key]=detail[key];
 out.session_ids=Array.isArray(detail.session_ids)?detail.session_ids.filter(n=>Number.isInteger(n)&&n>0&&n<=2147483647).slice(0,2):[];
 out.outcomes=Array.isArray(detail.outcomes)?detail.outcomes.slice(0,2).map(v=>contract.outcomes.includes(v)?v:'unknown'):[];
 out.rejections=Array.isArray(detail.rejections)?detail.rejections.slice(0,2).map(v=>({
  prisma_codes:Array.isArray(v.prisma_codes)?v.prisma_codes.filter(c=>contract.prisma_codes.includes(c)):[],
  sqlstates:Array.isArray(v.sqlstates)?v.sqlstates.filter(c=>contract.sqlstates.includes(c)):[],
  rejection_context:contract.contexts.includes(v.rejection_context)?v.rejection_context:'UNATTRIBUTED',
  unexpected_code:v.unexpected_code!==false
 })):[];
 return out;
}
module.exports={facts,expectedRejection,validPostconditions,safeStage};
