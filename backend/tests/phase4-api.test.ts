import { beforeEach,it,expect,vi } from 'vitest';
const mocks=vi.hoisted(()=>({actor:vi.fn(),finalize:vi.fn(),register:vi.fn(),checkIn:vi.fn(),status:vi.fn()}));
vi.mock('@/lib/session',()=>({requirePermission:mocks.actor,requireCompetitiveUser:mocks.actor}));
vi.mock('@/lib/rate-limit',()=>({enforceRateLimit:vi.fn()}));
vi.mock('@/lib/tournament-registration',()=>({finalizeTournament:mocks.finalize,registerEntrant:mocks.register,checkInPlayer:mocks.checkIn,playerAttendanceStatus:mocks.status}));
import { POST as finalize } from '../app/api/admin/tournaments/[tournamentId]/finalize/route';
import { POST as register } from '../app/api/tournaments/[tournamentId]/registrations/route';
import { POST as checkIn } from '../app/api/tournaments/[tournamentId]/check-in/route';
import { GET as attendance } from '../app/api/tournaments/[tournamentId]/attendance/route';
import { SecurityError } from '../lib/security-error';
const context={params:Promise.resolve({tournamentId:'event'})};
const request=(body:string,origin='https://arena.example')=>new Request('https://arena.example/api/tournaments/event',{method:'POST',headers:{origin,'content-type':'application/json'},body});
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('APP_URL','https://arena.example');mocks.actor.mockResolvedValue({id:'current-actor'});mocks.finalize.mockResolvedValue({classification:'ORDINARY'});mocks.register.mockResolvedValue({id:'entry'});});
it('rejects cross-origin requests before protected services',async()=>{expect((await register(request('{}','https://attacker.example'),context)).status).toBe(403);expect(mocks.register).not.toHaveBeenCalled();});
it('rejects manual classification overrides at finalization',async()=>{expect((await finalize(request('{"classification":"GRAND_BATTLE"}'),context)).status).toBe(400);expect(mocks.finalize).not.toHaveBeenCalled();});
it('requires authenticated independent role checks before finalization',async()=>{mocks.actor.mockRejectedValue(new SecurityError('FORBIDDEN'));expect((await finalize(request('{}'),context)).status).toBe(403);expect(mocks.finalize).not.toHaveBeenCalled();});
it('passes only the current session actor and route event to the finalizer',async()=>{expect((await finalize(request('{}'),context)).status).toBe(200);expect(mocks.finalize).toHaveBeenCalledWith('current-actor','event');});

it('sends self-check-in through only the authenticated session identity',async()=> {
  mocks.checkIn.mockResolvedValue({status:'CONFIRMED'});
  expect((await checkIn(request('{"latenessRequestId":"request-id"}'),context)).status).toBe(200);
  expect(mocks.checkIn).toHaveBeenCalledWith('current-actor','event',{latenessRequestId:'request-id'});
});
it('rejects unauthenticated check-in before changing attendance',async()=> {
  mocks.actor.mockRejectedValue(new Error('UNAUTHORIZED'));
  expect((await checkIn(request('{}'),context)).status).toBe(401);expect(mocks.checkIn).not.toHaveBeenCalled();
});
it('returns only private session-scoped attendance with no-store caching',async()=> {
  mocks.status.mockResolvedValue({attendance:'SELF_CONFIRMED'});
  const response=await attendance(new Request('https://arena.example/api/tournaments/event/attendance?playerId=another-player'),context);
  expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(mocks.status).toHaveBeenCalledWith('current-actor','event');
});
