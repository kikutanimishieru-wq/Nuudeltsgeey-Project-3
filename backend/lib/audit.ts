import type { Prisma } from '@prisma/client';

// A transaction client is mandatory: protected state and its audit commit together.
// Metadata is deliberately restricted; never pass request bodies, tokens or private evidence.
export function writeAudit(tx: Prisma.TransactionClient, data: {
  actorId: string;
  action: string;
  entityType: string;
  entityId?: string;
  tournamentId?: string;
  matchId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  return tx.auditEvent.create({ data: { ...data, metadata: data.metadata ?? undefined } });
}
