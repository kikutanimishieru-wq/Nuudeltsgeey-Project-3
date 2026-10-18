import type { Prisma } from '@prisma/client';
import { assertPermission, type Permission } from './permissions';
import { SecurityError } from './security-error';
export async function assertCurrentPermission(tx: Prisma.TransactionClient, actorId: string, permission: Permission) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actorId} FOR UPDATE`;
  const current = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, accountStatus: true } });
  if (!current) throw new SecurityError('FORBIDDEN');
  assertPermission(current, permission);
}
