import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export async function requireAdmin() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error('UNAUTHORIZED');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, accountStatus: true } });
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role) || user.accountStatus !== 'ACTIVE') throw new Error('FORBIDDEN');
  return user;
}

export async function requireUser() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error('UNAUTHORIZED');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, accountStatus: true, publicNmdId: true, profile: { select: { id: true } } } });
  if (!user || ['SUSPENDED', 'BADGE_REVOKED'].includes(user.accountStatus)) throw new Error('FORBIDDEN');
  return user;
}

export function authError(error: unknown) {
  if (error instanceof Error && error.message === 'UNAUTHORIZED') return { error: 'UNAUTHORIZED', status: 401 };
  if (error instanceof Error && error.message === 'FORBIDDEN') return { error: 'FORBIDDEN', status: 403 };
  return { error: 'ADMIN_OPERATION_FAILED', status: 500 };
}
