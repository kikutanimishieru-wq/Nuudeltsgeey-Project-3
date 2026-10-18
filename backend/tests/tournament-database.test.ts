import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
vi.mock('../lib/prisma', () => ({ prisma: { $transaction: vi.fn() } }));
import { prisma } from '../lib/prisma';
import { createHostedTournament, archiveHostedDraft } from '../lib/tournament-hosting';
import { configurationPolicy } from '../lib/tournament-configuration';
let db: PGlite;
type Query = Pick<PGlite,'query'>;
function adapter(database: Query, failAudit = false) {
  return {
    $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => (await database.query(parts.reduce((s,p,i) => s + (i ? `$${i}` : '') + p, ''),values)).rows,
    user: { findUnique: async ({ where }: any) => {
      const user = (await database.query<any>('SELECT "id","accountStatus" FROM "User" WHERE "id"=$1',[where.id])).rows[0];
      return user ? { ...user, profile: (await database.query('SELECT "id" FROM "PlayerProfile" WHERE "userId"=$1',[where.id])).rows[0], externalIdentities: (await database.query('SELECT * FROM "ExternalIdentity" WHERE "userId"=$1',[where.id])).rows } : null;
    } },
    tournament: {
      count: async ({ where }: any) => (await database.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM "Tournament" WHERE "hostUserId"=$1 AND "status" NOT IN (\'COMPLETED\',\'ARCHIVED\')',[where.hostUserId])).rows[0].n,
      create: async ({ data }: any) => {
        const row = { ...data, id: randomUUID() };
        await insert(database,row); return row;
      },
      findUnique: async ({ where }: any) => (await database.query('SELECT "hostUserId","configurationPolicy","status" FROM "Tournament" WHERE "id"=$1',[where.id])).rows[0],
      updateMany: async ({ where }: any) => ({ count: (await database.query('UPDATE "Tournament" SET "status"=\'ARCHIVED\' WHERE "id"=$1 AND "hostUserId"=$2 AND "status"=\'DRAFT\' AND "configurationPolicy"=$3 RETURNING "id"',[where.id,where.hostUserId,where.configurationPolicy])).rows.length }),
    },
    auditEvent: { create: async ({ data }: any) => database.query('INSERT INTO "AuditEvent" ("id","actorId","action","entityType","entityId","tournamentId","metadata") VALUES ($1,$2,$3,$4,$5,$6,$7)',[randomUUID(), failAudit ? 'missing-user' : data.actorId, data.action, data.entityType, data.entityId,data.tournamentId,JSON.stringify(data.metadata ?? {})]) },
  };
}
async function insert(database: Query, data: any) {
  return database.query('INSERT INTO "Tournament" ("id","hostUserId","configurationPolicy","entryFee","name","venue","format","style","capacity","teamSize","startersPerTeam","maxSubstitutes","rulesVersion","status","startsAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CURRENT_TIMESTAMP)',
    [data.id,data.hostUserId,data.configurationPolicy,data.entryFee,data.name,data.venue,data.format,data.style,data.capacity,data.teamSize,data.startersPerTeam,data.maxSubstitutes,data.rulesVersion,data.status,data.startsAt]);
}
const raw = (hostUserId: string) => ({ id: randomUUID(), hostUserId, configurationPolicy, entryFee: 0, name:'Community Draft',venue:'Local Cafe',format:'5v5',style:'Open Bracket',capacity:16,teamSize:5,startersPerTeam:5,maxSubstitutes:1,rulesVersion:'PENDING_APPROVAL',status:'DRAFT',startsAt:null });
beforeAll(async () => {
  db = new PGlite();
  const root = new URL('../prisma/migrations/',import.meta.url);
  for (const entry of (await readdir(root,{withFileTypes:true})).filter(e => e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (entry.name.includes('tournament_configuration')) {
      await db.exec(`INSERT INTO "User" ("id","email","passwordHash","publicNmdId","accountStatus","updatedAt") VALUES ('host','host@example.test','not-real','NMD-800001','ACTIVE',CURRENT_TIMESTAMP),('rollback','rollback@example.test','not-real','NMD-800002','ACTIVE',CURRENT_TIMESTAMP);
        INSERT INTO "PlayerProfile" ("id","userId","nickname","currentNr","floor") VALUES ('profile','host','Historical host',1234,1),('rollback-profile','rollback','Rollback',1000,1);
        INSERT INTO "ExternalIdentity" ("id","userId","provider","providerAccountId","verifiedAt") VALUES ('steam','host','STEAM','76561198000000001',CURRENT_TIMESTAMP),('discord','host','DISCORD','123456789012345678',CURRENT_TIMESTAMP),('rs','rollback','STEAM','76561198000000002',CURRENT_TIMESTAMP),('rd','rollback','DISCORD','123456789012345679',CURRENT_TIMESTAMP);
        INSERT INTO "Tournament" ("id","name","venue","format","style","capacity","updatedAt") VALUES ('legacy','Historical event','Cafe','3v3','Swiss System',3,CURRENT_TIMESTAMP);`);
    }
    await db.exec(await readFile(new URL(`${entry.name}/migration.sql`,root),'utf8'));
  }
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => db.transaction(tx => fn(adapter(tx as Query))));
},30000);
afterAll(async () => { await db.close(); });
describe('Phase 3 isolated PostgreSQL SQL (one connection; not Neon concurrency)', () => {
  it('preserves historical events, users and NR without guessing hosts', async () => {
    expect((await db.query('SELECT "hostUserId","configurationPolicy","capacity","style" FROM "Tournament" WHERE "id"=\'legacy\'')).rows[0]).toEqual({hostUserId:null,configurationPolicy:null,capacity:3,style:'Swiss System'});
    expect((await db.query('SELECT "currentNr","floor" FROM "PlayerProfile" WHERE "id"=\'profile\'')).rows[0]).toEqual({currentNr:1234,floor:1});
  });
  it('limits overlapping creation requests to three and audits only committed events', async () => {
    const results = await Promise.allSettled(Array.from({length:6},(_,i)=>createHostedTournament('host',{name:`Arena ${i}`,venue:'Community Cafe',format:'5v5',capacity:16})));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(3);
    expect(results.filter(r=>r.status==='rejected')).toHaveLength(3);
    expect((await db.query('SELECT COUNT(*)::int AS n FROM "AuditEvent" WHERE "actorId"=\'host\'')).rows[0]).toEqual({n:3});
  });
  it('enforces quota even for direct SQL and releases a slot by archiving without deletion', async () => {
    await expect(insert(db,raw('host'))).rejects.toThrow('HOSTING_LIMIT_REACHED');
    const id=(await db.query<{id:string}>('SELECT "id" FROM "Tournament" WHERE "hostUserId"=\'host\' LIMIT 1')).rows[0].id;
    await archiveHostedDraft('host',id);
    await createHostedTournament('host',{name:'Replacement',venue:'Cafe Hall',format:'1v1',capacity:64});
    expect((await db.query('SELECT COUNT(*)::int AS n FROM "Tournament" WHERE "hostUserId"=\'host\'')).rows[0]).toEqual({n:4});
  });
  it('rejects nonfree, unsupported and malformed configuration at the database boundary', async () => {
    for (const override of [{entryFee:1},{capacity:3},{style:'Swiss System'},{teamSize:3},{format:'4v4'}]) await expect(insert(db,{...raw('rollback'),...override})).rejects.toThrow();
  });
  it('rolls back creation and quota consumption when audit fails', async () => {
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any)=>db.transaction(tx=>fn(adapter(tx as Query,true))));
    await expect(createHostedTournament('rollback',{name:'Rollback Arena',venue:'Local Cafe',format:'5v5',capacity:16})).rejects.toThrow();
    expect((await db.query('SELECT COUNT(*)::int AS n FROM "Tournament" WHERE "hostUserId"=\'rollback\'')).rows[0]).toEqual({n:0});
  });
});
