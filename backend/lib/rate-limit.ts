import { createHmac } from 'node:crypto';
import { prisma } from './prisma';
import { SecurityError } from './security-error';

export function rateKey(scope: string, identity: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new SecurityError('AUTH_CONFIGURATION_REQUIRED', 503);
  return createHmac('sha256', secret).update(`${scope}\0${identity}`).digest('hex');
}

export async function enforceRateLimit(scope: string, identity: string, limit = 30, seconds = 60) {
  const key = rateKey(scope, identity);
  // Single PostgreSQL statement: shared across processes and never fails open.
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetsAt")
    VALUES (${key}, 1, CURRENT_TIMESTAMP + (${seconds} * INTERVAL '1 second'))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."resetsAt" <= CURRENT_TIMESTAMP THEN 1
                     ELSE LEAST("RateLimitBucket"."count" + 1, ${limit + 1}) END,
      "resetsAt" = CASE WHEN "RateLimitBucket"."resetsAt" <= CURRENT_TIMESTAMP
                        THEN CURRENT_TIMESTAMP + (${seconds} * INTERVAL '1 second')
                        ELSE "RateLimitBucket"."resetsAt" END
    RETURNING "count"`;
  if (!rows[0] || rows[0].count > limit) throw new SecurityError('RATE_LIMITED', 429);
}
