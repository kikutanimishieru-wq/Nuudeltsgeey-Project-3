import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('@/lib/prisma',()=>({prisma:{$transaction:vi.fn()}}));
import {prisma} from '../lib/prisma';
import {consumeLoginGrant,digest,newSecret} from '../lib/identity';
let tx:any;let ticket:string;
beforeEach(()=>{
 ticket=newSecret();tx={$queryRaw:vi.fn(),identityLoginGrant:{findUnique:vi.fn().mockResolvedValue({provider:'DISCORD',userId:'u',tokenHash:digest(ticket),browserHash:digest('browser'),expiresAt:new Date(Date.now()+60000),consumedAt:null}),updateMany:vi.fn().mockResolvedValue({count:1})},user:{findUnique:vi.fn().mockResolvedValue({id:'u',email:null,role:'PLAYER',accountStatus:'UNVERIFIED',publicNmdId:'NMD-000001'})},externalIdentity:{findUnique:vi.fn().mockResolvedValue({provider:'DISCORD',revokedAt:null,verifiedAt:new Date()})},auditEvent:{create:vi.fn()}};
 vi.mocked(prisma.$transaction).mockImplementation(async(fn:any)=>fn(tx));
});
it('consumes browser-bound Discord grant once and allows passwordless session user',async()=>{
 expect((await consumeLoginGrant(ticket,'browser'))?.id).toBe('u');
 tx.identityLoginGrant.updateMany.mockResolvedValue({count:0});expect(await consumeLoginGrant(ticket,'browser')).toBeNull();expect(tx.auditEvent.create).toHaveBeenCalledOnce();
});
it('rejects Steam grants before consumption or user lookup',async()=>{
 tx.identityLoginGrant.findUnique.mockResolvedValue({provider:'STEAM'});expect(await consumeLoginGrant(ticket,'browser')).toBeNull();expect(tx.identityLoginGrant.updateMany).not.toHaveBeenCalled();expect(tx.user.findUnique).not.toHaveBeenCalled();
});
it('rejects stolen browser secret before claiming grant',async()=>{
 await expect(consumeLoginGrant(ticket,'other')).rejects.toThrow('INVALID_IDENTITY_STATE');expect(tx.identityLoginGrant.updateMany).not.toHaveBeenCalled();
});
it('rejects expired unconsumed grant',async()=>{
 const grant=await tx.identityLoginGrant.findUnique();tx.identityLoginGrant.findUnique.mockResolvedValue({...grant,expiresAt:new Date(0),consumedAt:null});
 expect(await consumeLoginGrant(ticket,'browser')).toBeNull();expect(tx.identityLoginGrant.updateMany).not.toHaveBeenCalled();
});
it('rejects unexpired consumed grant independently',async()=>{
 const grant=await tx.identityLoginGrant.findUnique();tx.identityLoginGrant.findUnique.mockResolvedValue({...grant,expiresAt:new Date(Date.now()+60000),consumedAt:new Date()});
 expect(await consumeLoginGrant(ticket,'browser')).toBeNull();expect(tx.identityLoginGrant.updateMany).not.toHaveBeenCalled();
});
it('rejects expiry while waiting for the account lock',async()=>{
 const grant=await tx.identityLoginGrant.findUnique();tx.identityLoginGrant.findUnique.mockResolvedValue(grant);
 const start=Date.now();vi.useFakeTimers();vi.setSystemTime(start);
 tx.$queryRaw.mockImplementation(async()=>{vi.setSystemTime(start+61000);});
 try{expect(await consumeLoginGrant(ticket,'browser')).toBeNull();expect(tx.auditEvent.create).not.toHaveBeenCalled();}finally{vi.useRealTimers();}
});
it.each(['UNDER_REVIEW','SUSPENDED','BADGE_REVOKED'])('rejects current account restriction %s',async accountStatus=>{
 tx.user.findUnique.mockResolvedValue({id:'u',accountStatus});try{expect(await consumeLoginGrant(ticket,'browser')).toBeNull();}catch(error){expect((error as Error).message).toBe('ACCOUNT_RESTRICTED');}expect(tx.auditEvent.create).not.toHaveBeenCalled();
});
it('rejects revoked or held Discord identity at grant use',async()=>{
 for(const identity of [{revokedAt:new Date()},{administrativeHoldAt:new Date()}]){tx.externalIdentity.findUnique.mockResolvedValue(identity);expect(await consumeLoginGrant(ticket,'browser')).toBeNull();}expect(tx.auditEvent.create).not.toHaveBeenCalled();
});

it('rechecks account restriction and identity revocation after issuance',async()=>{
 const grant=await tx.identityLoginGrant.findUnique();expect(grant.consumedAt).toBeNull();
 tx.user.findUnique.mockResolvedValue({id:'u',accountStatus:'SUSPENDED'});expect(await consumeLoginGrant(ticket,'browser')).toBeNull();
 tx.user.findUnique.mockResolvedValue({id:'u',accountStatus:'ACTIVE'});tx.externalIdentity.findUnique.mockResolvedValue({revokedAt:new Date()});expect(await consumeLoginGrant(ticket,'browser')).toBeNull();expect(tx.auditEvent.create).not.toHaveBeenCalled();
});
