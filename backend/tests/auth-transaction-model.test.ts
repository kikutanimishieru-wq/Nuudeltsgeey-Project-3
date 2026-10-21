/** Offline copy-on-write transaction MODEL. Not evidence of PostgreSQL rollback. */
import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({transaction:vi.fn(),challenge:vi.fn(),signIn:vi.fn(),verify:vi.fn(),cookie:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:{$transaction:m.transaction,identityChallenge:{findUnique:m.challenge}}}));
vi.mock('@/auth',()=>({auth:vi.fn(),signIn:m.signIn}));
vi.mock('next/headers',()=>({cookies:async()=>({get:m.cookie,delete:vi.fn()})}));
vi.mock('@/lib/rate-limit',()=>({enforceRateLimit:vi.fn()}));
vi.mock('@/lib/identity-providers',async original=>({...await original<object>(),verifyDiscord:m.verify}));
import {GET} from '../app/api/identity/[provider]/callback/route';
import {digest,newSecret} from '../lib/identity';
const state=newSecret(),browser=newSecret(),subject='123456789012345678';
function initial(){return {users:[] as any[],profiles:[] as any[],identities:[] as any[],grants:[] as any[],audits:[] as any[],sequence:1,challenge:{tokenHash:digest(state),provider:'DISCORD',intent:'SIGN_IN',browserHash:digest(browser),expiresAt:new Date(Date.now()+60000),consumedAt:null as Date|null}};}
let committed:ReturnType<typeof initial>;let failure:string;let attempts:string[];
function attempt(name:string){attempts.push(name);if(name===failure)throw Object.assign(Error('synthetic-'+name),{code:name==='identity'?'P2002':undefined});}
beforeEach(()=>{
 vi.resetAllMocks();vi.stubEnv('APP_URL','https://arena.example');vi.stubEnv('DISCORD_ACCOUNT_PROVISIONING_ENABLED','1');vi.stubEnv('DATABASE_URL','postgresql://synthetic@invalid.invalid/test?schema=public');
 committed=initial();failure='';attempts=[];m.verify.mockResolvedValue(subject);m.cookie.mockReturnValue({value:browser});m.challenge.mockImplementation(async()=>structuredClone(committed.challenge));
 m.transaction.mockImplementation(async fn=>{
  const draft=structuredClone(committed);
  const tx={
   $queryRaw:async(strings:TemplateStringsArray)=>strings.join('').includes('current_schema()')?[{schema_name:'public',safe_path:true,user_target:true}]:strings.join('').includes('information_schema')?[{column_name:'email',is_nullable:'YES',data_type:'text'},{column_name:'passwordHash',is_nullable:'YES',data_type:'text'}]:[],
   $executeRaw:async(_strings:TemplateStringsArray,id:string,nmd:string)=>{attempt('user');draft.users.push({id,publicNmdId:nmd,role:'PLAYER',accountStatus:'UNVERIFIED',email:null,passwordHash:null});return 1;},
   identitySequence:{upsert:async()=>({nextValue:++draft.sequence})},
   identityChallenge:{updateMany:async()=>{if(draft.challenge.consumedAt)return {count:0};draft.challenge.consumedAt=new Date();return {count:1};}},
   playerProfile:{create:async({data}:any)=>{attempt('profile');draft.profiles.push(data);return data;}},
   externalIdentity:{findUnique:async({where}:any)=>draft.identities.find(x=>where.provider_providerAccountId?x.providerAccountId===where.provider_providerAccountId.providerAccountId:x.userId===where.userId_provider.userId)??null,create:async({data}:any)=>{attempt('identity');draft.identities.push(data);return data;}},
   user:{findUnique:async({where}:any)=>{const user=draft.users.find(x=>x.id===where.id);return user?{...user,profile:draft.profiles.find(x=>x.userId===user.id),externalIdentities:draft.identities.filter(x=>x.userId===user.id)}:null;},updateMany:vi.fn()},
   auditEvent:{create:async({data}:any)=>{attempt('audit');draft.audits.push(data);return data;}},
   identityLoginGrant:{create:async({data}:any)=>{attempt('grant');draft.grants.push(data);return data;}},
  };
  const result=await fn(tx);committed=draft;return result;
 });
});
const request=()=>new Request(`https://arena.example/api/identity/discord/callback?state=${state}&code=synthetic-code`);
const params={params:Promise.resolve({provider:'discord'})};
it.each(['profile','identity','audit','grant'])('failure at %s prevents logical transaction commit',async stage=>{
 failure=stage;const before=structuredClone(committed);const response=await GET(request(),params);
 expect(response.status).toBe(500);expect(attempts).toContain(stage);expect(committed).toEqual(before);expect(m.signIn).not.toHaveBeenCalled();expect(await response.text()).not.toContain('synthetic-');
});
it('commits one account and a replay cannot issue another grant',async()=>{
 expect((await GET(request(),params)).status).toBe(307);expect(committed.users).toHaveLength(1);expect(committed.profiles).toHaveLength(1);expect(committed.grants).toHaveLength(1);
 expect((await GET(request(),params)).status).toBe(400);expect(committed.users).toHaveLength(1);expect(committed.grants).toHaveLength(1);
});
it('unique-identity conflict fails closed without retry or model commit',async()=>{
 failure='identity';const response=await GET(request(),params);expect(response.status).toBe(500);expect(attempts.filter(x=>x==='identity')).toHaveLength(1);expect(committed.users).toHaveLength(0);expect(committed.profiles).toHaveLength(0);expect(committed.challenge.consumedAt).toBeNull();
});

it('actual resolver reuses committed account after session failure on a fresh challenge',async()=>{
 m.signIn.mockRejectedValueOnce(Error('session-only-failure')).mockResolvedValue(undefined);
 expect((await GET(request(),params)).status).toBe(500);expect(committed.users).toHaveLength(1);
 const id=committed.users[0].id,nmd=committed.users[0].publicNmdId,next=newSecret();
 committed.challenge={...initial().challenge,tokenHash:digest(next)};
 expect((await GET(new Request(`https://arena.example/api/identity/discord/callback?state=${next}&code=new-code`),params)).status).toBe(307);
 expect(committed.users).toHaveLength(1);expect(committed.profiles).toHaveLength(1);expect(committed.identities).toHaveLength(1);
 expect(committed.users[0].id).toBe(id);expect(committed.users[0].publicNmdId).toBe(nmd);expect(committed.grants).toHaveLength(2);
});
