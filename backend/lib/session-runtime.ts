/** Activation is deliberately impossible through environment/configuration in 2C. */
import type { Prisma } from '@prisma/client';
import type { SessionStore,SessionTransaction } from './persistent-session';
import { SecurityError } from './security-error';
export function persistentSessionsEnabled(): boolean { return false; }
export const unavailableSessionStore:SessionStore={
  async transaction(){throw new SecurityError('SESSION_SCHEMA_ADAPTER_REQUIRED',503);},
};
/** Proposed Prisma models/client do not exist. Never emulate persistence locally. */
export function sessionTransactionAdapter(_tx:Prisma.TransactionClient):SessionTransaction {
  throw new SecurityError('SESSION_SCHEMA_ADAPTER_REQUIRED',503);
}
