import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(()=>({ actor:vi.fn(), create:vi.fn(), list:vi.fn() }));
vi.mock('@/lib/session',()=>({requireCompetitiveUser:mocks.actor}));
vi.mock('@/lib/rate-limit',()=>({enforceRateLimit:vi.fn()}));
vi.mock('@/lib/tournament-hosting',()=>({createHostedTournament:mocks.create}));
vi.mock('@/lib/prisma',()=>({prisma:{tournament:{findMany:mocks.list}}}));
import { POST, GET } from '../app/api/tournaments/route';
import { SecurityError } from '../lib/security-error';
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('APP_URL','https://arena.example');mocks.actor.mockResolvedValue({id:'authenticated-host'});mocks.create.mockResolvedValue({id:'draft',status:'DRAFT'});});
const request=(origin='https://arena.example')=>new Request('https://arena.example/api/tournaments',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({name:'Arena',venue:'Cafe',format:'5v5',capacity:16})});
describe('tournament creation boundary',()=>{
  it('requires same-origin and verified identity before creation',async()=>{
    expect((await POST(request('https://attacker.example'),undefined)).status).toBe(403);expect(mocks.actor).not.toHaveBeenCalled();
    mocks.actor.mockRejectedValue(new SecurityError('COMPETITIVE_IDENTITY_REQUIRED'));
    expect((await POST(request(),undefined)).status).toBe(403);expect(mocks.create).not.toHaveBeenCalled();
  });
  it('uses the authenticated owner and returns a private draft response',async()=>{
    const response=await POST(request(),undefined);expect(response.status).toBe(201);expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.create).toHaveBeenCalledWith('authenticated-host',expect.objectContaining({format:'5v5'}));
  });
  it('returns quota conflicts without leaking implementation errors',async()=>{
    mocks.create.mockRejectedValue(new SecurityError('HOSTING_LIMIT_REACHED',409));
    expect((await POST(request(),undefined)).status).toBe(409);
  });
  it('keeps new private configurations out of public listings, including archived drafts',async()=>{
    mocks.list.mockResolvedValue([]);await GET(new Request('https://arena.example/api/tournaments'));
    expect(mocks.list.mock.calls[0][0].where.OR).toEqual([{configurationPolicy:null},{configurationPolicy:'PHASE3_FREE_OPEN_V1',status:{in:['REGISTRATION_OPEN','REGISTRATION_CLOSED','CHECK_IN','ROSTER_LOCKED','LIVE','COMPLETED']}}]);
  });
});
