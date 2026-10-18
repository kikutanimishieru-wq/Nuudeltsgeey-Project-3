import type { Prisma } from '@prisma/client';
import { configurationPolicy } from './tournament-configuration';
export const publicTournamentPolicy = { OR: [
  { configurationPolicy: null },
  { configurationPolicy, status: { in: ['REGISTRATION_OPEN','REGISTRATION_CLOSED','CHECK_IN','ROSTER_LOCKED','LIVE','COMPLETED'] } },
] } satisfies Prisma.TournamentWhereInput;
