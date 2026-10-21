import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({config:null as any,user:vi.fn(),compare:vi.fn(),grant:vi.fn(),audit:vi.fn(),rate:vi.fn(),lock:vi.fn()}));
vi.mock('next-auth',()=>({default:(config:unknown)=>{m.config=config;return {handlers:{},auth:vi.fn(),signIn:vi.fn(),signOut:vi.fn()};}}));
vi.mock('next-auth/providers/credentials',()=>({default:(config:unknown)=>config}));
vi.mock('bcryptjs',()=>({default:{compare:m.compare}}));
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>({value:'browser'})})}));
vi.mock('@/lib/prisma',()=>({prisma:{user:{findUnique:m.user},$transaction:async(fn:any)=>fn({$queryRaw:m.lock,user:{findUnique:m.user},auditEvent:{create:m.audit}})}}));
vi.mock('@/lib/rate-limit',()=>({enforceRateLimit:m.rate}));
vi.mock('@/lib/identity',()=>({consumeLoginGrant:m.grant,identityCookie:()=> 'identity-discord'}));
import '../auth';
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('DATABASE_URL','postgresql://synthetic@invalid.invalid/test?schema=public');m.compare.mockResolvedValue(true);m.lock.mockImplementation(async(strings:TemplateStringsArray)=>strings.join('').includes('current_schema()')?[{schema_name:'public',safe_path:true,user_target:true}]:[]);});
it.each(['PLAYER','REFEREE','ADMIN','SUPER_ADMIN'])('preserves legacy password access and role %s',async role=>{
 m.user.mockResolvedValue({id:'legacy',email:'legacy@example.invalid',passwordHash:'existing-hash',role,accountStatus:'ACTIVE',publicNmdId:'NMD-000010'});
 const user=await m.config.providers[0].authorize({email:'legacy@example.invalid',password:'synthetic'});
 expect(user.id).toBe('legacy');expect(user.role).toBe(role);expect(m.audit).toHaveBeenCalledOnce();
});
it('null-password accounts cannot authenticate through legacy credentials',async()=>{
 m.user.mockResolvedValue({id:'discord',passwordHash:null,role:'PLAYER',accountStatus:'UNVERIFIED'});
 expect(await m.config.providers[0].authorize({email:'synthetic@example.invalid',password:'synthetic'})).toBeNull();expect(m.audit).not.toHaveBeenCalled();
});
it('linked identity credentials accept Discord only, never Steam',async()=>{
 expect(await m.config.providers[1].authorize({ticket:'synthetic',provider:'STEAM'})).toBeNull();expect(m.grant).not.toHaveBeenCalled();
 m.grant.mockResolvedValue({id:'discord'});expect((await m.config.providers[1].authorize({ticket:'synthetic',provider:'DISCORD'})).id).toBe('discord');expect(m.grant).toHaveBeenCalledWith('synthetic','browser');
});

it('rejects a changed credential under the transaction lock without leaking hashes',async()=>{
 m.user.mockResolvedValueOnce({id:'legacy',passwordHash:'old-private-hash',accountStatus:'ACTIVE'}).mockResolvedValueOnce({id:'legacy',passwordHash:'new-private-hash',role:'ADMIN',accountStatus:'ACTIVE'});
 expect(await m.config.providers[0].authorize({email:'legacy@example.invalid',password:'synthetic'})).toBeNull();
 expect(m.lock).toHaveBeenCalledTimes(2);expect(m.lock.mock.invocationCallOrder[1]).toBeLessThan(m.user.mock.invocationCallOrder[1]);expect(m.audit).not.toHaveBeenCalled();
});
it('successful legacy login returns no password hash',async()=>{
 m.user.mockResolvedValue({id:'legacy',email:'legacy@example.invalid',passwordHash:'private-hash',role:'ADMIN',accountStatus:'ACTIVE',publicNmdId:'NMD-000010'});
 const result=await m.config.providers[0].authorize({email:'legacy@example.invalid',password:'synthetic'});
 expect(result).not.toHaveProperty('passwordHash');expect(JSON.stringify(m.audit.mock.calls)).not.toContain('private-hash');
});
