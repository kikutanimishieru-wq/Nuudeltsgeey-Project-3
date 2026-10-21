import {beforeEach,describe,it,expect,vi} from 'vitest';
import {resolveDiscordAccount,refreshCompetitiveStatus,assertDiscordSignIn} from '../lib/discord-accounts';
const subject='123456789012345678';
function database() {
  return {$queryRaw:vi.fn().mockImplementation(async(strings:TemplateStringsArray)=>strings.join('').includes('current_schema()')?[{schema_name:'public',safe_path:true,user_target:true}]:[{column_name:'email',is_nullable:'YES',data_type:'text'},{column_name:'passwordHash',is_nullable:'YES',data_type:'text'}]),$executeRaw:vi.fn(),
    externalIdentity:{findUnique:vi.fn().mockResolvedValue(null),create:vi.fn()},user:{findUnique:vi.fn(),updateMany:vi.fn().mockResolvedValue({count:1})},
    playerProfile:{create:vi.fn()},identitySequence:{upsert:vi.fn().mockResolvedValue({nextValue:2})},auditEvent:{create:vi.fn()}};
}
beforeEach(()=>{vi.stubEnv('DISCORD_ACCOUNT_PROVISIONING_ENABLED','1');vi.stubEnv('DATABASE_URL','postgresql://synthetic:synthetic@invalid.invalid/test?schema=public');});
describe('Discord account resolution (offline transaction model)',()=>{
 it('creates NULL credentials, player role/profile and stable Discord identity only',async()=>{
  const tx=database();const id=await resolveDiscordAccount(tx as never,subject);
  expect(tx.$executeRaw).toHaveBeenCalledOnce();expect(tx.$executeRaw.mock.calls[0][0].join('')).toContain("NULL,NULL,'PLAYER','UNVERIFIED'");
  expect(tx.playerProfile.create).toHaveBeenCalledWith({data:expect.objectContaining({userId:id,currentNr:1000})});
  expect(tx.externalIdentity.create).toHaveBeenCalledWith({data:expect.objectContaining({userId:id,provider:'DISCORD',providerAccountId:subject})});
  expect(JSON.stringify(tx.auditEvent.create.mock.calls)).not.toContain(subject);
 });
 it('defaults to disabled provisioning without credential-schema inspection or allocation',async()=>{
  vi.stubEnv('DISCORD_ACCOUNT_PROVISIONING_ENABLED','');const tx=database();await expect(resolveDiscordAccount(tx as never,subject)).rejects.toThrow('DISCORD_PROVISIONING_NOT_ENABLED');expect(tx.$executeRaw).not.toHaveBeenCalled();expect(tx.identitySequence.upsert).not.toHaveBeenCalled();
 });
 it('rejects missing, nonnullable or ambiguous schema without allocation',async()=>{
  for(const rows of [[],[{column_name:'email',is_nullable:'NO',data_type:'text'}],[{column_name:'email',is_nullable:'YES',data_type:'text'},{column_name:'email',is_nullable:'YES',data_type:'text'}]]){
   const tx=database();tx.$queryRaw.mockImplementation(async(strings:TemplateStringsArray)=>strings.join('').includes('current_schema()')?[{schema_name:'public',safe_path:true,user_target:true}]:rows);await expect(resolveDiscordAccount(tx as never,subject)).rejects.toThrow('PASSWORDLESS_SCHEMA_REQUIRED');expect(tx.$executeRaw).not.toHaveBeenCalled();expect(tx.identitySequence.upsert).not.toHaveBeenCalled();
  }
 });
 function returning(){const tx=database();tx.externalIdentity.findUnique.mockResolvedValue({userId:'existing',providerAccountId:subject,verifiedAt:new Date(),revokedAt:null});tx.user.findUnique.mockResolvedValue({accountStatus:'ACTIVE',profile:{id:'profile'},role:'ADMIN',externalIdentities:[]});return tx;}
 it('returning accounts preserve ID, role, credentials, profile and history',async()=>{
  vi.stubEnv('DISCORD_ACCOUNT_PROVISIONING_ENABLED','');const tx=returning();expect(await resolveDiscordAccount(tx as never,subject)).toBe('existing');expect(tx.$executeRaw).not.toHaveBeenCalled();expect(tx.playerProfile.create).not.toHaveBeenCalled();expect(tx.externalIdentity.create).not.toHaveBeenCalled();expect(tx.user.updateMany).not.toHaveBeenCalled();
 });
 it.each(['SUSPENDED','BADGE_REVOKED','UNDER_REVIEW'])('rejects restricted account %s',async status=>{const tx=returning();tx.user.findUnique.mockResolvedValue({accountStatus:status,profile:{id:'p'}});await expect(resolveDiscordAccount(tx as never,subject)).rejects.toThrow('ACCOUNT_RESTRICTED');expect(tx.$executeRaw).not.toHaveBeenCalled();});
 it('never re-creates revoked/held/conflicting Discord identities',async()=>{
  for(const patch of [{revokedAt:new Date(),revocationKind:'SELF'},{administrativeHoldAt:new Date()},{providerAccountId:'999999999999999999'}]){const tx=returning();tx.externalIdentity.findUnique.mockResolvedValue({userId:'existing',providerAccountId:subject,...patch});await expect(resolveDiscordAccount(tx as never,subject)).rejects.toThrow('IDENTITY_REQUIRES_REVIEW');expect(tx.externalIdentity.create).not.toHaveBeenCalled();}
 });
 it('does not swallow uniqueness or audit failures or retry',async()=>{
  for(const at of ['identity','audit']){const tx=database();(at==='identity'?tx.externalIdentity.create:tx.auditEvent.create).mockRejectedValue(new Error('conflict'));await expect(resolveDiscordAccount(tx as never,subject)).rejects.toThrow('conflict');expect(tx.$executeRaw).toHaveBeenCalledOnce();}
 });
 it('serializes simultaneous first sign-ins before identity lookup (simulated lock)',async()=>{
  let tail=Promise.resolve();let owner:string|undefined;let creates=0;let lookups=0;
  async function transaction(){const tx=database();let release:()=>void=()=>{};const previous=tail;tail=new Promise<void>(r=>{release=r;});
   tx.$queryRaw.mockImplementation(async(strings:TemplateStringsArray)=>{if(strings.join('').includes('current_schema()'))return [{schema_name:'public',safe_path:true,user_target:true}];if(strings.join('').includes('pg_advisory_xact_lock')){await previous;return [];}return [{column_name:'email',is_nullable:'YES',data_type:'text'},{column_name:'passwordHash',is_nullable:'YES',data_type:'text'}];});
   tx.externalIdentity.findUnique.mockImplementation(async()=>{lookups++;return owner?{userId:owner,providerAccountId:subject,revokedAt:null}:null;});
   tx.externalIdentity.create.mockImplementation(async({data})=>{creates++;owner=data.userId;return {} as never;});
   tx.user.findUnique.mockResolvedValue({accountStatus:'ACTIVE',profile:{id:'p'},role:'PLAYER',externalIdentities:[]});
   try{return await resolveDiscordAccount(tx as never,subject);}finally{release();}}
  const ids=await Promise.all([transaction(),transaction()]);expect(ids[0]).toBe(ids[1]);expect(creates).toBe(1);expect(lookups).toBe(3);
 });
 it('rejects Steam and invalid subjects before any account lookup',async()=>{expect(()=>assertDiscordSignIn('STEAM')).toThrow('DISCORD_SIGN_IN_REQUIRED');const tx=database();await expect(resolveDiscordAccount(tx as never,'display-name')).rejects.toThrow('INVALID_PROVIDER_RESPONSE');expect(tx.$queryRaw).not.toHaveBeenCalled();});
 it('activates only eligible player accounts without clearing any restriction',async()=>{
  const links=[{provider:'DISCORD',verifiedAt:new Date(),revokedAt:null},{provider:'STEAM',verifiedAt:new Date(),revokedAt:null}];
  for(const status of ['CREATED','UNVERIFIED','VERIFIED','ACTIVE','UNDER_REVIEW','SUSPENDED','BADGE_REVOKED']){
   const tx=database();tx.user.findUnique.mockResolvedValue({role:'PLAYER',accountStatus:status,externalIdentities:links});await refreshCompetitiveStatus(tx as never,'u');expect(tx.user.updateMany.mock.calls.length).toBe(['CREATED','UNVERIFIED','VERIFIED'].includes(status)?1:0);
  }
  for(const externalIdentities of [links.slice(0,1),[links[0],{...links[1],revokedAt:new Date(),revocationKind:'SELF'}],[links[0],{...links[1],administrativeHoldAt:new Date()}]]){const tx=database();tx.user.findUnique.mockResolvedValue({role:'PLAYER',accountStatus:'UNVERIFIED',externalIdentities});await refreshCompetitiveStatus(tx as never,'u');expect(tx.user.updateMany).not.toHaveBeenCalled();}
 });
});

it('rejects schema config and effective namespace mismatches before allocation',async()=>{
 for(const schema of ['other','public&schema=other']){vi.stubEnv('DATABASE_URL','postgresql://synthetic@invalid.invalid/test?schema='+schema);const tx=database();await expect(resolveDiscordAccount(tx as never,subject)).rejects.toThrow('UNSUPPORTED_AUTH_SCHEMA');expect(tx.identitySequence.upsert).not.toHaveBeenCalled();expect(tx.$executeRaw).not.toHaveBeenCalled();}
 vi.stubEnv('DATABASE_URL','postgresql://synthetic@invalid.invalid/test?schema=public');
 for(const row of [{schema_name:'other',safe_path:true,user_target:true},{schema_name:'public',safe_path:false,user_target:true},{schema_name:'public',safe_path:true,user_target:false},{schema_name:'public',safe_path:'true',user_target:true}]){const tx=database();tx.$queryRaw.mockResolvedValue([row]);await expect(resolveDiscordAccount(tx as never,subject)).rejects.toThrow('UNSUPPORTED_AUTH_SCHEMA');expect(tx.externalIdentity.findUnique).not.toHaveBeenCalled();expect(tx.identitySequence.upsert).not.toHaveBeenCalled();}
});
