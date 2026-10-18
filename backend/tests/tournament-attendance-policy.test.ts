import { describe,it,expect } from 'vitest';
import { checkInWindow,assertCheckInTime,protectedDeadline,completeEntrant } from '../lib/tournament-attendance-policy';
import { classifyVerifiedActiveStarters } from '../lib/tournament-configuration';
const start=new Date('2026-10-17T07:00:00.000Z');
describe('approved Phase 4 attendance and threshold policies',()=> {
  it('enforces exact opening and exclusive closing instants in UTC',()=> {
    const window=checkInWindow(start,{kind:'ORDINARY'});
    expect(window.opensAt.toISOString()).toBe('2026-10-17T06:45:00.000Z');
    expect(()=>assertCheckInTime(start,new Date(window.opensAt.getTime()-1))).toThrow('CHECK_IN_WINDOW_CLOSED');
    expect(()=>assertCheckInTime(start,window.opensAt)).not.toThrow();
    expect(()=>assertCheckInTime(start,new Date(start.getTime()-1))).not.toThrow();
    expect(()=>assertCheckInTime(start,start)).toThrow('CHECK_IN_WINDOW_CLOSED');
  });
  it('reserves 30 minutes for a separately scheduled already-classified Grand final',()=> {
    expect(checkInWindow(start,{kind:'GRAND_CHAMPIONSHIP_FINAL',separatelyScheduledFinal:true,lockedClassification:'GRAND_BATTLE'}).opensAt.toISOString()).toBe('2026-10-17T06:30:00.000Z');
    expect(()=>checkInWindow(start,{kind:'GRAND_CHAMPIONSHIP_FINAL',separatelyScheduledFinal:false,lockedClassification:'ORDINARY'} as any)).toThrow('LOCKED_GRAND_FINAL_REQUIRED');
  });
  it('protects Floor 2 for exactly 15 minutes from scheduled start; rejects Floor 1',()=> {
    expect(protectedDeadline(2,start).toISOString()).toBe('2026-10-17T07:15:00.000Z');
    expect(()=>protectedDeadline(1,start)).toThrow('FLOOR_2_REQUIRED');
  });
  it.each([1,2,3,5])('requires exactly %i verified attended active starters',n=> {
    const players=Array.from({length:n},()=>({isStarter:true,eligible:true,attended:true}));
    expect(completeEntrant(n,players)).toBe(true);
    expect(completeEntrant(n,[...players,{isStarter:false,eligible:false,attended:false}])).toBe(true);
    expect(completeEntrant(n,players.slice(1))).toBe(false);
    expect(completeEntrant(n,players.map((p,i)=>({...p,attended:i!==0})))).toBe(false);
  });
  it.each([63,64,65])('classifies %i distinct eligible active players',n=> {
    const teams=Array.from({length:n},(_,i)=>({players:[{playerId:`p${i}`,activeStarter:true,verifiedEligible:true},{playerId:`bench${i}`,activeStarter:false,verifiedEligible:true}]}));
    expect(classifyVerifiedActiveStarters('1v1',teams)).toEqual({activePlayerCount:n,classification:n>=64 ? 'GRAND_BATTLE':'ORDINARY'});
  });
});
