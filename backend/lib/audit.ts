import { prisma } from '@/lib/prisma';

export function writeAudit(data: {
  actorId: string;
  action: string;
  entityType: string;
  entityId?: string;
  tournamentId?: string;
  matchId?: string;
  metadata?: object;
}) {
  return prisma.auditEvent.create({ data: { ...data, metadata: data.metadata ?? undefined } });
}
