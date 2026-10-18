import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readdir,readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
vi.mock('../lib/prisma',()=>({prisma:{$transaction:vi.fn()}}));
import { attendanceRuleVersion, selfAttendancePolicy, registrationDeadline } from '../lib/tournament-attendance-policy';
import { prisma } from '../lib/prisma';
import { registerEntrant,checkInPlayer,editRoster,withdrawEntrant,recordLatenessClaim,finalizeTournament,openRegistration,snapshotDigest } from '../lib/tournament-registration';
let db:PGlite;
let now=new Date('2026-10-17T06:40:00Z');
const start='2026-10-17T07:00:00Z';
// Test adapter executes service reads/writes and constraints against isolated PostgreSQL.
// PGlite serializes transactions on one connection; this does not prove Neon multi-session behavior.
function adapter(sql:Pick<PGlite,'query'>,failAudit=false):any {
  const tables:Record<string,string>={tournament:'Tournament',user:'User',playerProfile:'PlayerProfile',team:'Team',teamMembership:'TeamMembership',tournamentRegistration:'TournamentRegistration',tournamentRosterMember:'TournamentRosterMember',tournamentLatenessClaim:'TournamentLatenessClaim',tournamentLatenessRequest:'TournamentLatenessRequest',tournamentRegistrationPolicy:'TournamentRegistrationPolicy',tournamentLockSnapshot:'TournamentLockSnapshot',auditEvent:'AuditEvent'};
  const api:any={$queryRaw:async(parts:TemplateStringsArray,...values:any[])=> {
    const query=parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,'');
    if (query.includes('clock_timestamp')) return [{now}];
    return (await sql.query(query,values)).rows;
  }};
  const all=async(model:string)=> (await sql.query<any>(`SELECT * FROM "${tables[model]}"`)).rows;
  async function matches(row:any,where:any):Promise<boolean> {
    if (!where) return true;
    for (const [key,value] of Object.entries(where)) {
      if (key==='registration') {const parent=(await all('tournamentRegistration')).find(p=>p.id===row.registrationId);if (!parent || !await matches(parent,value)) return false;continue;}
      if (key==='tournamentId_playerId' || key==='registrationId_playerId') {if (!await matches(row,value)) return false;continue;}
      if (value && typeof value==='object' && !(value instanceof Date)) {
        const v=value as any;
        if ('in' in v && !v.in.includes(row[key])) return false;
        if ('notIn' in v && v.notIn.includes(row[key])) return false;
        if ('not' in v && row[key]===v.not) return false;
        if ('some' in v && key==='tournamentRosters') {
          const member=(await all('tournamentRosterMember'));let found=false;
          for (const m of member) if(m.playerId===row.id && await matches(m,v.some)) found=true;
          if(!found)return false;
        }
      } else if (row[key] !== value) return false;
    } return true;
  }
  async function hydrate(model:string,row:any,include:any) {
    if (!row) return null;
    if (model==='tournament' && include) {
      row.registrationPolicy=(await sql.query('SELECT * FROM "TournamentRegistrationPolicy" WHERE "tournamentId"=$1',[row.id])).rows[0]??null;
      row.lockSnapshot=(await all('tournamentLockSnapshot')).find(r=>r.tournamentId===row.id)??null;
    }
    if (model==='tournamentLatenessRequest' && include?.claim) row.claim=(await all('tournamentLatenessClaim')).find(c=>c.id===row.claimId);
    if (model==='user') {
      row.profile=(await all('playerProfile')).find(p=>p.userId===row.id)??null;
      row.externalIdentities=(await sql.query('SELECT * FROM "ExternalIdentity" WHERE "userId"=$1',[row.id])).rows;
    }
    if (model==='tournamentRegistration' && include?.roster) {
      row.roster=(await all('tournamentRosterMember')).filter(p=>p.registrationId===row.id);
      if (include.roster.include?.player) for(const m of row.roster) m.player=(await all('playerProfile')).find(p=>p.id===m.playerId);
    }
    return row;
  }
  for (const model of Object.keys(tables)) {
    const findMany=async(args:any={})=> { const result=[];for(const row of await all(model))if(await matches(row,args.where))result.push(await hydrate(model,row,args.include));return result; };
    api[model]={findMany,findFirst:async(args:any)=>(await findMany(args))[0]??null,findUnique:async(args:any)=>(await findMany(args))[0]??null,count:async(args:any)=>(await findMany(args)).length,
      create:async({data}:any)=> {
        if (model==='auditEvent' && failAudit) throw new Error('AUDIT_FAILED');
        const {roster,...flat}=data;const row={...(['tournamentLockSnapshot','tournamentRegistrationPolicy'].includes(model)?{}:{id:randomUUID()}),...flat};
        const keys=Object.keys(row).filter(k=>row[k]!==undefined);
        const values=keys.map(k=>k==='snapshot' || k==='metadata'?JSON.stringify(row[k]):row[k]);
        const created=(await sql.query(`INSERT INTO "${tables[model]}" (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,values)).rows[0];
        if(roster)for(const m of roster.create)await api.tournamentRosterMember.create({data:{registrationId:row.id,...m}});
        return created;
      },
      update:async({where,data}:any)=> {
        const row=(await findMany({where}))[0]; if(!row)throw new Error('MISSING_ROW');
        const keys=Object.keys(data);const id=model==='tournamentLockSnapshot'?'tournamentId':'id';
        return (await sql.query(`UPDATE "${tables[model]}" SET ${keys.map((k,i)=>`"${k}"=$${i+1}`).join(',')} WHERE "${id}"=$${keys.length+1} RETURNING *`,[...keys.map(k=>data[k]),row[id]])).rows[0];
      },
      updateMany:async({where,data}:any)=> {const rows=await findMany({where});for(const row of rows)await api[model].update({where:{id:row.id},data});return {count:rows.length};},
      deleteMany:async({where}:any)=> {const rows=await findMany({where});for(const row of rows)await sql.query(`DELETE FROM "${tables[model]}" WHERE "id"=$1`,[row.id]);return{count:rows.length};},
    };
  }
  return api;
}
async function player(id:string,floor=1,role='PLAYER') {
  await db.query('INSERT INTO "User" ("id","email","passwordHash","publicNmdId","accountStatus","role","updatedAt") VALUES ($1,$2,\'fixture\',$1,\'ACTIVE\',$3,CURRENT_TIMESTAMP)',[id,`${id}@example.test`,role]);
  await db.query('INSERT INTO "PlayerProfile" ("id","userId","nickname","floor") VALUES ($1,$1,$1,$2)',[id,floor]);
  for(const provider of ['STEAM','DISCORD'])await db.query('INSERT INTO "ExternalIdentity" ("id","userId","provider","providerAccountId","verifiedAt") VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)',[`${provider}-${id}`,id,provider,String((provider==='STEAM'?BigInt('76561198000000000'):BigInt('123456789012345678'))+BigInt([...id].reduce((n,c)=>(n*31+c.charCodeAt(0))%100000000,0)))]);
}
async function event(id:string,format='1v1',capacity=2,attendance=true) {
  const n=Number(format[0]); await player(`host-${id}`);
  await db.query('INSERT INTO "Tournament" ("id","name","venue","format","style","capacity","teamSize","startersPerTeam","maxSubstitutes","configurationPolicy","entryFee","status","startsAt","rulesVersion","updatedAt","hostUserId") VALUES ($1,$1,\'Cafe\',$2,\'Open Bracket\',$3,$4,$4,$5,\'PHASE3_FREE_OPEN_V1\',0,\'REGISTRATION_OPEN\',$6,\'OWNER_PHASE4_FINAL_2026_10_16\',CURRENT_TIMESTAMP,$7)',[id,format,capacity,n,format==='1v1'?0:1,start,`host-${id}`]);
  await db.query('INSERT INTO "TournamentRegistrationPolicy" VALUES ($1,$2,\'OWNER_PHASE4_FINAL_2026_10_16\',\'OWNER_PHASE4_FINAL_2026_10_16\',$3)',[id,registrationDeadline(new Date(start)),attendance?selfAttendancePolicy:null]);
}
const solo=(id:string)=>({roster:[{playerId:id,isStarter:true}]});
async function attend(eventId:string,id:string) {
  const previous=now;now=new Date('2026-10-17T06:50:00Z');
  try { await checkInPlayer(id,eventId); } finally { now=previous; }
}
beforeAll(async()=> {
  db=new PGlite({parsers:{1114:(value:string)=>new Date(value.replace(' ','T')+'Z')}});const root=new URL('../prisma/migrations/',import.meta.url);
  for(const dir of (await readdir(root,{withFileTypes:true})).filter(d=>d.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))) {
    if(dir.name.endsWith('registration_lock')) await db.exec(`
      INSERT INTO "User" ("id","email","passwordHash","publicNmdId","updatedAt") VALUES ('historic','historic@example.test','fixture','NMD-HISTORY',CURRENT_TIMESTAMP);
      INSERT INTO "PlayerProfile" ("id","userId","nickname","currentNr") VALUES ('historic','historic','Historic player',1432);
      INSERT INTO "Team" ("id","name","captainId") VALUES ('historic-team','Historic team','historic');
      INSERT INTO "Tournament" ("id","name","venue","format","style","capacity","updatedAt") VALUES ('historic-event','Historical','Cafe','3v3','Swiss System',3,CURRENT_TIMESTAMP);
      INSERT INTO "TournamentRegistration" ("id","tournamentId","teamId","status","checkInStatus") VALUES ('historic-entry','historic-event','historic-team','APPROVED','PRESENT');
      INSERT INTO "TournamentRosterMember" ("id","registrationId","playerId") VALUES ('historic-roster','historic-entry','historic');
    `);
    if(dir.name.endsWith('final_attendance_governance')) await db.exec(`
      INSERT INTO "TournamentLatenessClaim" ("id","tournamentId","playerId","scheduledStart","protectedDeadline","reason","evidenceRef") VALUES ('historic-claim','historic-event','historic','2026-10-01T07:00:00Z','2026-10-01T07:15:00Z','Historical pending review','private:history');
    `);
    if(dir.name.endsWith('phase4_database_invariants')) {
      await player('preexisting-current-player');await player('preexisting-current-ref',1,'REFEREE');await event('preexisting-current-event');
      await db.exec(`
        INSERT INTO "TournamentRegistration" ("id","tournamentId","soloPlayerId","status","rosterLockedAt") VALUES ('preexisting-current-entry','preexisting-current-event','preexisting-current-player','APPROVED','2026-10-17 07:16:00');
        INSERT INTO "TournamentRosterMember" ("id","registrationId","playerId","checkedInAt","checkInRuleVersion") VALUES ('preexisting-current-roster','preexisting-current-entry','preexisting-current-player','2026-10-17T06:50:00Z','OWNER_PHASE4_FINAL_2026_10_16');
        UPDATE "Tournament" SET "status"='ROSTER_LOCKED' WHERE "id"='preexisting-current-event';
        INSERT INTO "TournamentLockSnapshot" ("tournamentId","lockedAt","lockedById","rulesVersion","activePlayerCount","classification","snapshot","digest") VALUES ('preexisting-current-event','2026-10-17T07:16:00Z','preexisting-current-ref','OWNER_PHASE4_FINAL_2026_10_16',1,'ORDINARY','{"entrants":[{"registrationId":"preexisting-current-entry","players":[{"playerId":"preexisting-current-player","activeStarter":true}]}]}','historical-digest-preserved');
      `);
    }
    await db.exec(await readFile(new URL(`${dir.name}/migration.sql`,root),'utf8'));
  }
  for(const id of ['a','b','c','d','e','f','g','h','i','j','k','l'])await player(id);
  await player('floor2',2);await player('ref',1,'REFEREE');
  vi.mocked(prisma.$transaction).mockImplementation(async(fn:any)=>db.transaction(tx=>fn(adapter(tx as any))));
},30000);
afterAll(async()=>{await db.close();});
describe('Phase 4 isolated PostgreSQL service/constraint regression',()=> {
  it('preserves existing IDs, team registrations, check-in records, historical formats and NR',async()=> {
    expect((await db.query('SELECT "id","teamId","checkInStatus","soloPlayerId" FROM "TournamentRegistration" WHERE "id"=\'historic-entry\'')).rows[0]).toEqual({id:'historic-entry',teamId:'historic-team',checkInStatus:'PRESENT',soloPlayerId:null});
    expect((await db.query('SELECT "decision","usedAt","policyVersion" FROM "TournamentLatenessClaim" WHERE "id"=\'historic-claim\'')).rows[0]).toEqual({decision:'PENDING_GOVERNANCE',usedAt:null,policyVersion:null});
    expect((await db.query('SELECT "currentNr" FROM "PlayerProfile" WHERE "id"=\'historic\'')).rows[0]).toEqual({currentNr:1432});
    expect((await db.query('SELECT "format","style","capacity","configurationPolicy" FROM "Tournament" WHERE "id"=\'historic-event\'')).rows[0]).toEqual({format:'3v3',style:'Swiss System',capacity:3,configurationPolicy:null});
  });
  it('requires approved deadline instead of inventing it',async()=> {
    await event('gate');await db.query('DELETE FROM "TournamentRegistrationPolicy" WHERE "tournamentId"=\'gate\'');
    await expect(registerEntrant('a','gate',solo('a'))).rejects.toThrow('EVENT_REQUIRES_FINAL_GOVERNANCE_OPENING');
  });
  it('serializes overlapping registrations; rejects duplicates and exceeding capacity',async()=> {
    await event('race');
    const results=await Promise.allSettled(['a','b','c','d'].map(id=>registerEntrant(id,'race',solo(id))));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(2);
    expect((await db.query('SELECT COUNT(*)::int n FROM "AuditEvent" WHERE "tournamentId"=\'race\'')).rows[0]).toEqual({n:2});
    await expect(registerEntrant('a','race',solo('a'))).rejects.toThrow('DUPLICATE_TOURNAMENT_PARTICIPATION');
  });
  it('blocks manual classification and another player’s solo registration',async()=> {
    await event('override');
    await expect(registerEntrant('a','override',{...solo('a'),classification:'GRAND_BATTLE'})).rejects.toThrow('INVALID_INPUT');
    await expect(registerEntrant('a','override',solo('b'))).rejects.toThrow('ENTRANT_FORMAT_MISMATCH');
    await expect(openRegistration('b','override')).rejects.toThrow('ONLY_TOURNAMENT_HOST');
  });
  it('records individual check-in once and rejects server-time boundary violations',async()=> {
    await event('check');await registerEntrant('a','check',solo('a'));
    now=new Date('2026-10-17T06:44:59.999Z');await expect(checkInPlayer('a','check')).rejects.toThrow('CHECK_IN_WINDOW_CLOSED');
    now=new Date('2026-10-17T06:45:00Z');const receipt=await checkInPlayer('a','check');expect(receipt.attendance).toBe('SELF_CONFIRMED');
    await checkInPlayer('a','check');
    now=new Date(start);expect(await checkInPlayer('a','check')).toMatchObject({status:'CONFIRMED'});
    now=new Date('2026-10-17T06:40:00Z');
  });
  it('automatically approves a personal late check-in and atomically consumes one incident',async()=> {
    await event('late');await registerEntrant('floor2','late',solo('floor2'));await registerEntrant('a','late',solo('a'));
    now=new Date(start);
    const attempts=await Promise.allSettled([0,1].map(()=>recordLatenessClaim('floor2','late',{reason:'Delayed transport'})));
    expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const request=(attempts.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<any>).value;
    expect(request.status).toBe('REQUESTED');
    await expect(recordLatenessClaim('floor2','late',{reason:'Second request'})).rejects.toThrow('LATENESS_REQUEST_ALREADY_PENDING');
    await expect(recordLatenessClaim('a','late',{reason:'Late'})).rejects.toThrow('FLOOR_2_REQUIRED');
    await expect(finalizeTournament('ref','late')).rejects.toThrow('FLOOR_2_PROTECTION_WINDOW_PENDING');
    const results=await Promise.allSettled([0,1].map(()=>checkInPlayer('floor2','late',{latenessRequestId:request.id})));
    expect(results.every(r=>r.status==='fulfilled')).toBe(true);
    expect((await db.query<any>('SELECT "decision","usedAt" FROM "TournamentLatenessClaim" WHERE "tournamentId"=$1',['late'])).rows[0]).toMatchObject({decision:'AUTO_APPROVED',usedAt:now});
    expect((await db.query<any>('SELECT COUNT(*)::int n FROM "AuditEvent" WHERE "tournamentId"=$1 AND "action"=\'LATENESS_AUTOMATICALLY_APPROVED_AND_USED\'',['late'])).rows[0].n).toBe(1);
    await expect(recordLatenessClaim('floor2','late',{reason:'Again'})).rejects.toThrow('PLAYER_ALREADY_CHECKED_IN');
    now=new Date('2026-10-17T06:40:00Z');
  });
  it('expires requests without consuming protection and resolves missing starters after the deadline',async()=> {
    await event('late-review');await registerEntrant('floor2','late-review',solo('floor2'));await registerEntrant('a','late-review',solo('a'));await attend('late-review','a');
    now=new Date('2026-10-17T07:10:00Z');
    const request=await recordLatenessClaim('floor2','late-review',{reason:'Transport'});
    await expect(finalizeTournament('ref','late-review')).rejects.toThrow('FLOOR_2_PROTECTION_WINDOW_PENDING');
    now=new Date('2026-10-17T07:15:00.001Z');
    await expect(checkInPlayer('floor2','late-review',{latenessRequestId:request.id})).rejects.toThrow('PROTECTED_CHECK_IN_DEADLINE_PASSED');
    expect((await db.query<any>('SELECT "status" FROM "TournamentLatenessRequest" WHERE "id"=$1',[request.id])).rows[0].status).toBe('EXPIRED');
    expect((await db.query<any>('SELECT "usedAt" FROM "TournamentLatenessClaim" WHERE "tournamentId"=$1',['late-review'])).rows[0].usedAt).toBeNull();
    expect((await finalizeTournament('ref','late-review')).activePlayerCount).toBe(1);
    now=new Date('2026-10-17T06:40:00Z');
  });
  it('withdraws without deleting history and rechecks capacity before classification',async()=> {
    await event('withdraw');const a=await registerEntrant('a','withdraw',solo('a'));await registerEntrant('b','withdraw',solo('b'));
    await withdrawEntrant('a','withdraw',a.id);await registerEntrant('c','withdraw',solo('c'));
    await attend('withdraw','b');await attend('withdraw','c');now=new Date('2026-10-17T07:16:00Z');
    const result=await finalizeTournament('ref','withdraw');expect(result.activePlayerCount).toBe(2);
    now=new Date('2026-10-17T06:40:00Z');
  });
  it('atomically locks classification once; preserves it after withdrawal; rejects tampering',async()=> {
    await event('lock');const a=await registerEntrant('a','lock',solo('a'));await registerEntrant('b','lock',solo('b'));await attend('lock','a');await attend('lock','b');
    now=new Date('2026-10-17T07:16:00Z');
    const results=await Promise.allSettled([finalizeTournament('ref','lock'),finalizeTournament('ref','lock')]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const saved=(await db.query<any>('SELECT "snapshot","digest" FROM "TournamentLockSnapshot" WHERE "tournamentId"=\'lock\'')).rows[0];
    expect(snapshotDigest(saved.snapshot)).toBe(saved.digest);
    await withdrawEntrant('a','lock',a.id);
    expect((await db.query('SELECT "activePlayerCount","classification" FROM "TournamentLockSnapshot" WHERE "tournamentId"=\'lock\'')).rows[0]).toEqual({activePlayerCount:2,classification:'ORDINARY'});
    await expect(db.query('UPDATE "TournamentLockSnapshot" SET "activePlayerCount"=64,"classification"=\'GRAND_BATTLE\' WHERE "tournamentId"=\'lock\'')).rejects.toThrow('LOCK_SNAPSHOT_IMMUTABLE');
    await expect(db.query('DELETE FROM "TournamentLockSnapshot" WHERE "tournamentId"=\'lock\'')).rejects.toThrow('LOCK_SNAPSHOT_IMMUTABLE');
    await expect(db.query('UPDATE "Tournament" SET "capacity"=64 WHERE "id"=\'lock\'')).rejects.toThrow('TOURNAMENT_SETTINGS_LOCKED');
    await expect(editRoster('a','lock',a.id,{roster:solo('a').roster})).rejects.toThrow('TOURNAMENT_ROSTER_LOCKED');
    now=new Date('2026-10-17T06:40:00Z');
  });
  it('leaves no partial lock when atomic audit writing fails',async()=> {
    await event('audit');await registerEntrant('a','audit',solo('a'));await registerEntrant('b','audit',solo('b'));await attend('audit','a');await attend('audit','b');
    now=new Date('2026-10-17T07:16:00Z');
    vi.mocked(prisma.$transaction).mockImplementationOnce(async(fn:any)=>db.transaction(tx=>fn(adapter(tx as any,true))));
    await expect(finalizeTournament('ref','audit')).rejects.toThrow('AUDIT_FAILED');
    expect((await db.query('SELECT * FROM "TournamentLockSnapshot" WHERE "tournamentId"=\'audit\'')).rows).toHaveLength(0);
    expect((await db.query('SELECT "status" FROM "Tournament" WHERE "id"=\'audit\'')).rows[0]).toEqual({status:'REGISTRATION_OPEN'});
    now=new Date('2026-10-17T06:40:00Z');
  });
  it.each(['2v2','3v3','5v5'])('registers and locks complete %s teams',async format=> {
    const eventId=`teams-${format}`,n=Number(format[0]);await event(eventId,format);
    for(let t=0;t<2;t++) {
      const ids=Array.from({length:n},(_,i)=>`${format}-team${t}-p${i}`);
      for(const id of ids)await player(id);
      const teamId=`${eventId}-${t}`;
      await db.query('INSERT INTO "Team" ("id","name","captainId") VALUES ($1,$1,$2)',[teamId,ids[0]]);
      for(const id of ids)await db.query('INSERT INTO "TeamMembership" ("id","teamId","playerId") VALUES ($1,$2,$3)',[randomUUID(),teamId,id]);
      await registerEntrant(ids[0],eventId,{teamId,roster:ids.map(playerId=>({playerId,isStarter:true}))});
      for(const id of ids)await attend(eventId,id);
    }
    now=new Date('2026-10-17T07:16:00Z');
    expect((await finalizeTournament('ref',eventId)).activePlayerCount).toBe(n*2);
    now=new Date('2026-10-17T06:40:00Z');
  });
  it('activates a registered substitute before lock and excludes an unused bench player',async()=> {
    const eventId='substitute';await event(eventId,'5v5');
    for(let t=0;t<2;t++) {
      const ids=Array.from({length:6},(_,i)=>`sub-team${t}-p${i}`);for(const id of ids)await player(id);
      const teamId=`sub-team-${t}`;
      await db.query('INSERT INTO "Team" ("id","name","captainId") VALUES ($1,$1,$2)',[teamId,ids[0]]);
      for(const id of ids)await db.query('INSERT INTO "TeamMembership" ("id","teamId","playerId") VALUES ($1,$2,$3)',[randomUUID(),teamId,id]);
      const registration=await registerEntrant(ids[0],eventId,{teamId,roster:ids.map((playerId,i)=>({playerId,isStarter:i<5}))});
      const roster=ids.map((playerId,i)=>({playerId,isStarter:i!==4}));
      await expect(editRoster('a',eventId,registration.id,{roster})).rejects.toThrow('ONLY_TEAM_CAPTAIN');
      await editRoster(ids[0],eventId,registration.id,{roster});
      for(const member of roster.filter(p=>p.isStarter))await attend(eventId,member.playerId);
    }
    now=new Date('2026-10-17T07:16:00Z');expect((await finalizeTournament('ref',eventId)).activePlayerCount).toBe(10);
    now=new Date('2026-10-17T06:40:00Z');
  });
  it('disqualifies an incomplete team atomically and excludes it from classification',async()=> {
    const eventId='incomplete';await event(eventId,'2v2',4);
    let incompleteId='';
    for(let t=0;t<3;t++) {
      const ids=Array.from({length:t===2?1:2},(_,i)=>`inc-team${t}-p${i}`);for(const id of ids)await player(id);
      const teamId=`inc-team-${t}`;await db.query('INSERT INTO "Team" ("id","name","captainId") VALUES ($1,$1,$2)',[teamId,ids[0]]);
      for(const id of ids)await db.query('INSERT INTO "TeamMembership" ("id","teamId","playerId") VALUES ($1,$2,$3)',[randomUUID(),teamId,id]);
      const entry=await registerEntrant(ids[0],eventId,{teamId,roster:ids.map(playerId=>({playerId,isStarter:true}))});if(t===2)incompleteId=entry.id;
      for(const id of ids)await attend(eventId,id);
    }
    now=new Date('2026-10-17T07:16:00Z');expect((await finalizeTournament('ref',eventId)).activePlayerCount).toBe(4);
    expect((await db.query<any>('SELECT "disqualificationReason" FROM "TournamentRegistration" WHERE "id"=$1',[incompleteId])).rows[0].disqualificationReason).toBe('INCOMPLETE_ACTIVE_STARTERS');
    now=new Date('2026-10-17T06:40:00Z');
  });
  it('persists automatic Grand classification and preserves it after post-lock withdrawal',async()=> {
    const eventId='grand';await event(eventId,'1v1',64);let first='';
    for(let i=0;i<64;i++) {const id=`grand-player-${i}`;await player(id);const entry=await registerEntrant(id,eventId,solo(id));if(i===0)first=entry.id;await attend(eventId,id);}
    now=new Date('2026-10-17T07:16:00Z');
    expect(await finalizeTournament('ref',eventId)).toMatchObject({classification:'GRAND_BATTLE',activePlayerCount:64});
    await withdrawEntrant('grand-player-0',eventId,first);
    expect((await db.query<any>('SELECT "classification","activePlayerCount" FROM "TournamentLockSnapshot" WHERE "tournamentId"=$1',[eventId])).rows[0]).toEqual({classification:'GRAND_BATTLE',activePlayerCount:64});
    now=new Date('2026-10-17T06:40:00Z');
  },30000);
  it('opens a private draft under the newly approved version without rewriting historical policies',async()=> {
    await event('opening','2v2');
    await db.query('DELETE FROM "TournamentRegistrationPolicy" WHERE "tournamentId"=\'opening\'');
    await db.query('UPDATE "Tournament" SET "status"=\'DRAFT\' WHERE "id"=\'opening\'');
    await expect(openRegistration('a','opening')).rejects.toThrow('ONLY_TOURNAMENT_HOST');
    expect(await openRegistration('host-opening','opening')).toMatchObject({rulesVersion:attendanceRuleVersion,registrationClosesAt:new Date('2026-10-17T06:45:00Z')});
    expect((await db.query<any>('SELECT "maxSubstitutes" FROM "Tournament" WHERE "id"=\'opening\'')).rows[0].maxSubstitutes).toBe(1);
  });
  it('accepts registration immediately before closing and rejects the exact closing instant and after',async()=> {
    await event('boundaries');now=new Date('2026-10-17T06:44:59.999Z');await registerEntrant('a','boundaries',solo('a'));
    expect((await db.query<any>('SELECT "checkedInAt" FROM "TournamentRosterMember" WHERE "registrationId" IN (SELECT "id" FROM "TournamentRegistration" WHERE "tournamentId"=\'boundaries\')')).rows[0].checkedInAt).toBeNull();
    for(const stamp of ['2026-10-17T06:45:00Z','2026-10-17T06:45:00.001Z']){now=new Date(stamp);await expect(registerEntrant('b','boundaries',solo('b'))).rejects.toThrow('REGISTRATION_CLOSED');}
    now=new Date('2026-10-17T06:40:00Z');
  });
  it('rejects checking in another player or an unregistered player',async()=> {
    await event('self-only');await registerEntrant('a','self-only',solo('a'));now=new Date('2026-10-17T06:50:00Z');
    await expect(checkInPlayer('a','self-only',{playerId:'b'})).rejects.toThrow('INVALID_INPUT');
    await expect(checkInPlayer('b','self-only')).rejects.toThrow('REGISTRATION_NOT_FOUND');
    expect((await db.query<any>('SELECT "checkedInAt" FROM "TournamentRosterMember" WHERE "registrationId" IN (SELECT "id" FROM "TournamentRegistration" WHERE "tournamentId"=\'self-only\')')).rows[0].checkedInAt).toBeNull();
    now=new Date('2026-10-17T06:40:00Z');
  });
  it('requires a non-empty personal reason and accepts protected arrival exactly at the deadline',async()=> {
    await event('exact-late');await registerEntrant('floor2','exact-late',solo('floor2'));now=new Date(start);
    for(const input of [{},{reason:''},{reason:'   '}])await expect(recordLatenessClaim('floor2','exact-late',input)).rejects.toThrow('INVALID_INPUT');
    await expect(recordLatenessClaim('floor2','exact-late',{reason:'Delay',matchId:'not-scheduled'})).rejects.toThrow('MATCH_SCHEDULE_INTEGRATION_UNAVAILABLE');
    const request=await recordLatenessClaim('floor2','exact-late',{reason:'Bus delayed'});
    now=new Date('2026-10-17T07:15:00Z');expect(await checkInPlayer('floor2','exact-late',{latenessRequestId:request.id})).toMatchObject({status:'CONFIRMED',checkedInAt:now});
    now=new Date('2026-10-17T07:20:00Z');expect(await checkInPlayer('floor2','exact-late',{latenessRequestId:request.id})).toMatchObject({status:'CONFIRMED'});
    const claim=(await db.query<any>('SELECT * FROM "TournamentLatenessClaim" WHERE "tournamentId"=\'exact-late\'')).rows[0];
    await expect(db.query('UPDATE "TournamentLatenessClaim" SET "usedAt"=NULL,"decision"=\'REQUESTED\' WHERE "id"=$1',[claim.id])).rejects.toThrow('LATENESS_INCIDENT_ALREADY_USED');
    await expect(db.query('INSERT INTO "TournamentLatenessRequest" ("id","claimId","tournamentId","scheduledStart","protectedDeadline","reason","policyVersion","status","completedAt") VALUES ($1,$2,$3,$4,$5,\'Replay\',$6,\'AUTO_APPROVED\',$5)',[randomUUID(),claim.id,'exact-late',new Date(start),new Date('2026-10-17T07:15:00Z'),attendanceRuleVersion])).rejects.toThrow('one_consumed_lateness_request');
    now=new Date('2026-10-17T06:40:00Z');
  });
  it('cannot consume another player’s pending request',async()=> {
    await player('other-floor2',2);await event('request-owner');await registerEntrant('floor2','request-owner',solo('floor2'));await registerEntrant('other-floor2','request-owner',solo('other-floor2'));
    now=new Date(start);const request=await recordLatenessClaim('floor2','request-owner',{reason:'Delay'});
    await expect(checkInPlayer('other-floor2','request-owner',{latenessRequestId:request.id})).rejects.toThrow('LATENESS_REQUEST_NOT_FOUND');
    expect((await db.query<any>('SELECT "usedAt" FROM "TournamentLatenessClaim" WHERE "tournamentId"=\'request-owner\'')).rows[0].usedAt).toBeNull();
    now=new Date('2026-10-17T06:40:00Z');
  });
  it('rolls back the request decision, usage and attendance together if audit insertion fails',async()=> {
    await event('late-audit');await registerEntrant('floor2','late-audit',solo('floor2'));now=new Date(start);
    const request=await recordLatenessClaim('floor2','late-audit',{reason:'Delay'});
    vi.mocked(prisma.$transaction).mockImplementationOnce(async(fn:any)=>db.transaction(tx=>fn(adapter(tx as any,true))));
    await expect(checkInPlayer('floor2','late-audit',{latenessRequestId:request.id})).rejects.toThrow('AUDIT_FAILED');
    expect((await db.query<any>('SELECT "usedAt" FROM "TournamentLatenessClaim" WHERE "tournamentId"=\'late-audit\'')).rows[0].usedAt).toBeNull();
    expect((await db.query<any>('SELECT "status" FROM "TournamentLatenessRequest" WHERE "id"=$1',[request.id])).rows[0].status).toBe('REQUESTED');
    expect(await checkInPlayer('floor2','late-audit',{latenessRequestId:request.id})).toMatchObject({status:'CONFIRMED'});
    now=new Date('2026-10-17T06:40:00Z');
  });
  it.each(['2v2','3v3','5v5'])('allows exactly one optional substitute in %s with current membership',async format=> {
    const n=Number(format[0]),eventId=`one-sub-${format}`,teamId=`one-sub-team-${format}`;await event(eventId,format);
    const ids=Array.from({length:n+2},(_,i)=>`${eventId}-p${i}`);for(const id of ids)await player(id);
    await db.query('INSERT INTO "Team" ("id","name","captainId") VALUES ($1,$1,$2)',[teamId,ids[0]]);
    for(const id of ids)await db.query('INSERT INTO "TeamMembership" ("id","teamId","playerId") VALUES ($1,$2,$3)',[randomUUID(),teamId,id]);
    const entry=await registerEntrant(ids[0],eventId,{teamId,roster:ids.slice(0,n+1).map((playerId,i)=>({playerId,isStarter:i<n}))});
    await expect(editRoster(ids[0],eventId,entry.id,{roster:ids.map((playerId,i)=>({playerId,isStarter:i<n}))})).rejects.toThrow(format==='5v5'?'INVALID_INPUT':'SUBSTITUTE_LIMIT_EXCEEDED');
    await db.query('UPDATE "TeamMembership" SET "leftAt"=CURRENT_TIMESTAMP WHERE "teamId"=$1 AND "playerId"=$2',[teamId,ids[n]]);
    await expect(editRoster(ids[0],eventId,entry.id,{roster:ids.slice(0,n+1).map((playerId,i)=>({playerId,isStarter:i<n}))})).rejects.toThrow('CURRENT_TEAM_MEMBERSHIP_REQUIRED');
  });
  it('does not disqualify a team while its Floor 2 starter can still arrive, including a lock/check-in race',async()=> {
    const eventId='protected-team',teamId='protected-team-one';await event(eventId,'2v2');
    await db.query('INSERT INTO "Team" ("id","name","captainId") VALUES ($1,$1,\'a\')',[teamId]);
    for(const id of ['a','floor2'])await db.query('INSERT INTO "TeamMembership" ("id","teamId","playerId") VALUES ($1,$2,$3)',[randomUUID(),teamId,id]);
    await registerEntrant('a',eventId,{teamId,roster:['a','floor2'].map(playerId=>({playerId,isStarter:true}))});await attend(eventId,'a');
    now=new Date(start);const request=await recordLatenessClaim('floor2',eventId,{reason:'Delayed'});
    const race=await Promise.allSettled([finalizeTournament('ref',eventId),checkInPlayer('floor2',eventId,{latenessRequestId:request.id})]);
    expect(race[0].status).toBe('rejected');expect(race[1].status).toBe('fulfilled');
    const result=await finalizeTournament('ref',eventId);expect(result.activePlayerCount).toBe(2);
    expect((await db.query<any>('SELECT "disqualifiedAt" FROM "TournamentRegistration" WHERE "tournamentId"=$1',[eventId])).rows[0].disqualifiedAt).toBeNull();
    now=new Date('2026-10-17T06:40:00Z');
  });
  it('locks 63 eligible entrants after one absence without inventing byes or eliminating eligible players',async()=> {
    const eventId='ordinary-63';await event(eventId,'1v1',64);
    for(let i=0;i<64;i++){const id=`field63-${i}`;await player(id);await registerEntrant(id,eventId,solo(id));if(i<63)await attend(eventId,id);}
    now=new Date('2026-10-17T07:16:00Z');expect(await finalizeTournament('ref',eventId)).toMatchObject({classification:'ORDINARY',activePlayerCount:63});
    expect((await db.query<any>('SELECT COUNT(*)::int n FROM "Match" WHERE "tournamentId"=$1',[eventId])).rows[0].n).toBe(0);
    now=new Date('2026-10-17T06:40:00Z');
  },30000);
  it('excludes an ineligible starter without revoking identity or rewriting historical attendance',async()=> {
    await event('eligibility');await registerEntrant('a','eligibility',solo('a'));await registerEntrant('b','eligibility',solo('b'));await attend('eligibility','a');await attend('eligibility','b');
    await db.query('UPDATE "ExternalIdentity" SET "administrativeHoldAt"=CURRENT_TIMESTAMP WHERE "userId"=\'b\' AND "provider"=\'STEAM\'');
    now=new Date('2026-10-17T07:16:00Z');expect((await finalizeTournament('ref','eligibility')).activePlayerCount).toBe(1);
    expect((await db.query<any>('SELECT "accountStatus" FROM "User" WHERE "id"=\'b\'')).rows[0].accountStatus).toBe('ACTIVE');
    await db.query('UPDATE "ExternalIdentity" SET "administrativeHoldAt"=NULL WHERE "userId"=\'b\' AND "provider"=\'STEAM\'');
    now=new Date('2026-10-17T06:40:00Z');
  });
  it('preserves pre-remediation final-policy rosters and already-locked snapshots',async()=> {
    expect((await db.query<any>('SELECT "activePlayerCount","classification","digest" FROM "TournamentLockSnapshot" WHERE "tournamentId"=\'preexisting-current-event\'')).rows[0]).toEqual({activePlayerCount:1,classification:'ORDINARY',digest:'historical-digest-preserved'});
    expect((await db.query<any>('SELECT "id","playerId","checkInRuleVersion" FROM "TournamentRosterMember" WHERE "id"=\'preexisting-current-roster\'')).rows[0]).toEqual({id:'preexisting-current-roster',playerId:'preexisting-current-player',checkInRuleVersion:attendanceRuleVersion});
    await expect(db.query('DELETE FROM "TournamentLockSnapshot" WHERE "tournamentId"=\'preexisting-current-event\'')).rejects.toThrow('LOCK_SNAPSHOT_IMMUTABLE');
  });
  it('enforces capacity against direct SQL and rejects shrinking below registered entrants',async()=> {
    await event('sql-capacity');await registerEntrant('a','sql-capacity',solo('a'));await registerEntrant('b','sql-capacity',solo('b'));
    await expect(db.query('INSERT INTO "TournamentRegistration" ("id","tournamentId","soloPlayerId","status") VALUES ($1,\'sql-capacity\',\'c\',\'APPROVED\')',[randomUUID()])).rejects.toThrow('TOURNAMENT_CAPACITY_REACHED');
    await event('sql-shrink','1v1',4);for(const id of ['a','b','c'])await registerEntrant(id,'sql-shrink',solo(id));
    await expect(db.query('UPDATE "Tournament" SET "capacity"=2 WHERE "id"=\'sql-shrink\'')).rejects.toThrow('TOURNAMENT_CAPACITY_REACHED');
    const entry=(await db.query<any>('SELECT "id" FROM "TournamentRegistration" WHERE "tournamentId"=\'sql-capacity\' AND "soloPlayerId"=\'a\'')).rows[0];
    await withdrawEntrant('a','sql-capacity',entry.id);expect(await registerEntrant('c','sql-capacity',solo('c'))).toMatchObject({status:'APPROVED'});
  });
  it('rejects direct SQL duplicate participation across different team entrants and reactivation',async()=> {
    await event('sql-duplicate','2v2',4);
    for(let n=0;n<2;n++) {
      const team=`sql-duplicate-team-${n}`;await db.query('INSERT INTO "Team" ("id","name") VALUES ($1,$1)',[team]);
      await db.query('INSERT INTO "TournamentRegistration" ("id","tournamentId","teamId","status") VALUES ($1,\'sql-duplicate\',$2,\'APPROVED\')',[`sql-reg-${n}`,team]);
    }
    await db.query('INSERT INTO "TournamentRosterMember" ("id","registrationId","playerId") VALUES (\'sql-roster-0\',\'sql-reg-0\',\'a\')');
    await expect(db.query('INSERT INTO "TournamentRosterMember" ("id","registrationId","playerId") VALUES (\'sql-roster-1\',\'sql-reg-1\',\'a\')')).rejects.toThrow('DUPLICATE_TOURNAMENT_PARTICIPATION');
    await db.query('UPDATE "TournamentRegistration" SET "withdrawnAt"=CURRENT_TIMESTAMP WHERE "id"=\'sql-reg-0\'');
    await db.query('INSERT INTO "TournamentRosterMember" ("id","registrationId","playerId") VALUES (\'sql-roster-1\',\'sql-reg-1\',\'a\')');
    await expect(db.query('UPDATE "TournamentRegistration" SET "withdrawnAt"=NULL WHERE "id"=\'sql-reg-0\'')).rejects.toThrow('DUPLICATE_TOURNAMENT_PARTICIPATION');
  });
  it('prevents disabling final-governance protection by changing the policy marker',async()=> {
    await event('sql-downgrade');
    await expect(db.query('UPDATE "Tournament" SET "configurationPolicy"=NULL WHERE "id"=\'sql-downgrade\'')).rejects.toThrow('PHASE4_POLICY_DOWNGRADE_UNAVAILABLE');
    await expect(db.query('UPDATE "Tournament" SET "rulesVersion"=\'1.0\' WHERE "id"=\'sql-downgrade\'')).rejects.toThrow('PHASE4_POLICY_DOWNGRADE_UNAVAILABLE');
  });
  it('rejects stale-snapshot isolation for protected mutations',async()=> {
    await event('sql-isolation');
    await expect(db.transaction(async tx=> {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await tx.query('INSERT INTO "TournamentRegistration" ("id","tournamentId","soloPlayerId") VALUES ($1,\'sql-isolation\',\'a\')',[randomUUID()]);
    })).rejects.toThrow('PHASE4_UNSUPPORTED_ISOLATION');
  });
  it('derives snapshot count and entrant/lineup sets in PostgreSQL instead of trusting client JSON',async()=> {
    await event('sql-snapshot');await registerEntrant('a','sql-snapshot',solo('a'));await registerEntrant('b','sql-snapshot',solo('b'));await attend('sql-snapshot','a');await attend('sql-snapshot','b');
    now=new Date('2026-10-17T07:16:00Z');
    async function insertSnapshot(count:number,change:(value:any)=>any=(v=>v)) {
      return db.transaction(async tx=> {
        await tx.query('UPDATE "TournamentRegistration" SET "rosterLockedAt"=$1 WHERE "tournamentId"=\'sql-snapshot\'',[now]);
        await tx.query('UPDATE "Tournament" SET "status"=\'ROSTER_LOCKED\' WHERE "id"=\'sql-snapshot\'');
        const entries=(await tx.query<any>('SELECT r."id",m."playerId",m."isStarter" FROM "TournamentRegistration" r JOIN "TournamentRosterMember" m ON m."registrationId"=r."id" WHERE r."tournamentId"=\'sql-snapshot\'')).rows;
        const snapshot=change({entrants:entries.map(row=>({registrationId:row.id,players:[{playerId:row.playerId,activeStarter:row.isStarter}]}))});
        await tx.query('INSERT INTO "TournamentLockSnapshot" ("tournamentId","lockedAt","lockedById","rulesVersion","activePlayerCount","classification","snapshot","digest") VALUES (\'sql-snapshot\',$1,\'ref\',$2,$3,$4,$5,$6)',[now,attendanceRuleVersion,count,count>=64?'GRAND_BATTLE':'ORDINARY',JSON.stringify(snapshot),snapshotDigest(snapshot)]);
      });
    }
    await expect(insertSnapshot(64)).rejects.toThrow('SNAPSHOT_PARTICIPANT_COUNT_MISMATCH');
    await expect(insertSnapshot(2,snapshot=>({...snapshot,entrants:snapshot.entrants.slice(1)}))).rejects.toThrow('SNAPSHOT_ENTRANT_SET_MISMATCH');
    await expect(insertSnapshot(2,snapshot=>{snapshot.entrants[0].players[0].activeStarter=false;return snapshot;})).rejects.toThrow('SNAPSHOT_LINEUP_MISMATCH');
    await db.query('UPDATE "ExternalIdentity" SET "administrativeHoldAt"=CURRENT_TIMESTAMP WHERE "userId"=\'a\' AND "provider"=\'STEAM\'');
    await expect(insertSnapshot(2)).rejects.toThrow('SNAPSHOT_IDENTITY_REQUIRED');
    await db.query('UPDATE "ExternalIdentity" SET "administrativeHoldAt"=NULL WHERE "userId"=\'a\' AND "provider"=\'STEAM\'');
    await db.query('UPDATE "TournamentRosterMember" SET "isStarter"=FALSE WHERE "registrationId" IN (SELECT "id" FROM "TournamentRegistration" WHERE "tournamentId"=\'sql-snapshot\') AND "playerId"=\'a\'');
    await expect(insertSnapshot(2)).rejects.toThrow('SNAPSHOT_INCOMPLETE_ENTRANT');
    await db.query('UPDATE "TournamentRosterMember" SET "isStarter"=TRUE WHERE "registrationId" IN (SELECT "id" FROM "TournamentRegistration" WHERE "tournamentId"=\'sql-snapshot\') AND "playerId"=\'a\'');
    expect((await finalizeTournament('ref','sql-snapshot')).activePlayerCount).toBe(2);
    now=new Date('2026-10-17T06:40:00Z');
  });
  it('rejects direct snapshot insertion with absent or incomplete active starters',async()=> {
    await event('sql-absent');await registerEntrant('a','sql-absent',solo('a'));now=new Date('2026-10-17T07:16:00Z');
    await expect(db.transaction(async tx=> {
      await tx.query('UPDATE "TournamentRegistration" SET "rosterLockedAt"=$1 WHERE "tournamentId"=\'sql-absent\'',[now]);
      await tx.query('UPDATE "Tournament" SET "status"=\'ROSTER_LOCKED\' WHERE "id"=\'sql-absent\'');
      await tx.query('INSERT INTO "TournamentLockSnapshot" ("tournamentId","lockedAt","lockedById","rulesVersion","activePlayerCount","classification","snapshot","digest") VALUES (\'sql-absent\',$1,\'ref\',$2,1,\'ORDINARY\',\'{"entrants":[]}\',\'forged\')',[now,attendanceRuleVersion]);
    })).rejects.toThrow('SNAPSHOT_ATTENDANCE_REQUIRED');
    now=new Date('2026-10-17T06:40:00Z');
  });
  it('enforces the approved registration deadline including the closing instant',async()=> {
    await event('deadline');now=new Date(start);
    await expect(registerEntrant('a','deadline',solo('a'))).rejects.toThrow('REGISTRATION_CLOSED');
    now=new Date('2026-10-17T06:40:00Z');
  });
  it('uses ordinary player confirmation without an independent physical-presence claim',async()=> {
    await event('evidence');await registerEntrant('a','evidence',solo('a'));await attend('evidence','a');now=new Date(start);
    await expect(finalizeTournament('a','evidence')).rejects.toThrow('FORBIDDEN');
    expect((await finalizeTournament('ref','evidence')).activePlayerCount).toBe(1);
    expect((await db.query<any>('SELECT "attendanceVerifiedAt","attendanceEvidenceRef" FROM "TournamentRosterMember" WHERE "playerId"=\'a\' AND "registrationId" IN (SELECT "id" FROM "TournamentRegistration" WHERE "tournamentId"=\'evidence\')')).rows[0]).toEqual({attendanceVerifiedAt:null,attendanceEvidenceRef:null});
    now=new Date('2026-10-17T06:40:00Z');
  });
});
