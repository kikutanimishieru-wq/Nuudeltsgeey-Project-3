import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
vi.mock('../lib/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }));
import { prisma } from '../lib/prisma';
import { attachVerifiedIdentity } from '../lib/identity';
import { enforceRateLimit, rateKey } from '../lib/rate-limit';

let db: PGlite;
type QueryDb = Pick<PGlite, 'query'>;
function tagged(database: QueryDb) {
  return async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const sql = parts.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '');
    return (await database.query(sql, values)).rows;
  };
}
function identityTransaction(database: QueryDb, failAudit = false) {
  return {
    $queryRaw: tagged(database),
    user: { findUnique: async ({ where }: any) => (await database.query('SELECT "id", "accountStatus" FROM "User" WHERE "id"=$1', [where.id])).rows[0] },
    externalIdentity: {
      findUnique: async ({ where }: any) => {
        const key = where.userId_provider ?? where.provider_providerAccountId;
        const field = where.userId_provider ? 'userId' : 'providerAccountId';
        return (await database.query(`SELECT * FROM "ExternalIdentity" WHERE "${field}"=$1 AND "provider"=$2`, [key[field], key.provider])).rows[0] ?? null;
      },
      create: async ({ data }: any) => database.query('INSERT INTO "ExternalIdentity" ("id","userId","provider","providerAccountId","verifiedAt") VALUES ($1,$2,$3,$4,$5)', [randomUUID(), data.userId, data.provider, data.providerAccountId, data.verifiedAt]),
      update: async ({ where, data }: any) => database.query('UPDATE "ExternalIdentity" SET "verifiedAt"=$2,"revokedAt"=NULL,"revocationKind"=NULL WHERE "id"=$1', [where.id, data.verifiedAt]),
    },
    auditEvent: { create: async ({ data }: any) => database.query('INSERT INTO "AuditEvent" ("id","actorId","action","entityType","entityId","metadata") VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), failAudit ? 'nonexistent-actor' : data.actorId, data.action, data.entityType, data.entityId, JSON.stringify(data.metadata ?? {})]) },
  };
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('../prisma/migrations/20261012003031_foundation/migration.sql', import.meta.url), 'utf8'));
  await db.exec(`INSERT INTO "User" ("id","email","passwordHash","publicNmdId","accountStatus","updatedAt") VALUES
    ('existing','existing@example.test','not-a-real-password','NMD-900001','ACTIVE',CURRENT_TIMESTAMP),
    ('other','other@example.test','not-a-real-password','NMD-900002','ACTIVE',CURRENT_TIMESTAMP);
    INSERT INTO "PlayerProfile" ("id","userId","nickname","currentNr","floor") VALUES ('profile','existing','Historical',1234,4);`);
  await db.exec(await readFile(new URL('../prisma/migrations/20261016093000_identity_authority/migration.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../prisma/migrations/20261016103000_identity_hardening/migration.sql', import.meta.url), 'utf8'));
}, 30000);
afterAll(async () => { await db.close(); vi.unstubAllEnvs(); });
describe('Phase 2 isolated PostgreSQL SQL (single connection, not Neon concurrency)', () => {
  it('adds tables without altering existing identity/rating or granting verification', async () => {
    expect((await db.query('SELECT "currentNr", "floor" FROM "PlayerProfile" WHERE "id"=\'profile\'')).rows[0]).toEqual({ currentNr: 1234, floor: 4 });
    expect((await db.query('SELECT "publicNmdId","accountStatus" FROM "User" WHERE "id"=\'existing\'')).rows[0]).toEqual({ publicNmdId: 'NMD-900001', accountStatus: 'ACTIVE' });
    expect((await db.query('SELECT COUNT(*)::int AS n FROM "ExternalIdentity"')).rows[0]).toEqual({ n: 0 });
  });
  it('rolls back identity when a real audit insert fails', async () => {
    await expect(db.transaction(async tx => attachVerifiedIdentity(identityTransaction(tx as QueryDb, true) as never, 'existing', 'STEAM', '76561198000000001'))).rejects.toThrow();
    expect((await db.query('SELECT COUNT(*)::int AS n FROM "ExternalIdentity"')).rows[0]).toEqual({ n: 0 });
    expect((await db.query('SELECT COUNT(*)::int AS n FROM "AuditEvent"')).rows[0]).toEqual({ n: 0 });
  });
  it('commits identity and audit together and enforces both uniqueness constraints', async () => {
    await db.transaction(async tx => attachVerifiedIdentity(identityTransaction(tx as QueryDb) as never, 'existing', 'STEAM', '76561198000000001'));
    await expect(db.query('INSERT INTO "ExternalIdentity" ("id","userId","provider","providerAccountId","verifiedAt") VALUES ($1,\'other\',\'STEAM\',\'76561198000000001\',CURRENT_TIMESTAMP)', [randomUUID()])).rejects.toThrow();
    await expect(db.query('INSERT INTO "ExternalIdentity" ("id","userId","provider","providerAccountId","verifiedAt") VALUES ($1,\'existing\',\'STEAM\',\'76561198000000002\',CURRENT_TIMESTAMP)', [randomUUID()])).rejects.toThrow();
    expect((await db.query('SELECT COUNT(*)::int AS n FROM "AuditEvent"')).rows[0]).toEqual({ n: 1 });
  });
  it('limits overlapping callers to the budget and resets expired buckets', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-only-secret');
    vi.mocked(prisma.$queryRaw).mockImplementation(tagged(db) as never);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => enforceRateLimit('test', 'actor', 8)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(8);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(12);
    await db.query('UPDATE "RateLimitBucket" SET "resetsAt"=CURRENT_TIMESTAMP-INTERVAL \'1 second\' WHERE "key"=$1', [rateKey('test', 'actor')]);
    await expect(enforceRateLimit('test', 'actor', 8)).resolves.toBeUndefined();
  });
  it('enforces challenge/session invariants and consumes once', async () => {
    await expect(db.query('INSERT INTO "IdentityChallenge" ("tokenHash","provider","intent","browserHash","expiresAt") VALUES (\'invalid\',\'STEAM\',\'LINK\',\'browser\',CURRENT_TIMESTAMP+INTERVAL \'1 minute\')')).rejects.toThrow();
    await db.query('INSERT INTO "IdentityChallenge" ("tokenHash","provider","intent","browserHash","expiresAt") VALUES (\'challenge\',\'STEAM\',\'SIGN_IN\',\'browser\',CURRENT_TIMESTAMP+INTERVAL \'1 minute\')');
    const consume = () => db.query('UPDATE "IdentityChallenge" SET "consumedAt"=CURRENT_TIMESTAMP WHERE "tokenHash"=\'challenge\' AND "consumedAt" IS NULL AND "expiresAt">CURRENT_TIMESTAMP RETURNING "tokenHash"');
    const results = await Promise.all([consume(), consume()]);
    expect(results.reduce((sum, result) => sum + result.rows.length, 0)).toBe(1);
  });
  it('persists administrative holds when fresh provider proof is rejected', async () => {
    await db.query(`UPDATE "ExternalIdentity" SET "administrativeHoldAt"=CURRENT_TIMESTAMP, "revokedAt"=CURRENT_TIMESTAMP, "revocationKind"='ADMIN' WHERE "userId"='existing'`);
    await expect(db.transaction(async tx => attachVerifiedIdentity(identityTransaction(tx as QueryDb) as never, 'existing', 'STEAM', '76561198000000001'))).rejects.toThrow('IDENTITY_SECURITY_HOLD');
    const row = (await db.query<{ revocationKind: string; administrativeHoldAt: Date }>('SELECT "revocationKind","administrativeHoldAt" FROM "ExternalIdentity" WHERE "userId"=\'existing\'')).rows[0];
    expect(row.revocationKind).toBe('ADMIN'); expect(row.administrativeHoldAt).not.toBeNull();
    expect((await db.query('SELECT COUNT(*)::int AS n FROM "AuditEvent"')).rows[0]).toEqual({ n: 1 });
  });
  it('keeps released identities unverified until a new successful proof', async () => {
    await db.query(`UPDATE "ExternalIdentity" SET "administrativeHoldAt"=NULL,"revocationKind"='ADMIN_CLEARED' WHERE "userId"='existing'`);
    expect((await db.query('SELECT "revokedAt" FROM "ExternalIdentity" WHERE "userId"=\'existing\'')).rows[0]).not.toEqual({ revokedAt: null });
    await db.transaction(async tx => attachVerifiedIdentity(identityTransaction(tx as QueryDb) as never, 'existing', 'STEAM', '76561198000000001'));
    expect((await db.query('SELECT "revokedAt","revocationKind" FROM "ExternalIdentity" WHERE "userId"=\'existing\'')).rows[0]).toEqual({ revokedAt: null, revocationKind: null });
  });
});
