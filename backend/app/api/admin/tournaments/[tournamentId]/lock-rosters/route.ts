import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authError, requireAdmin } from '@/lib/session';
import { writeAudit } from '@/lib/audit';

export async function POST(_: Request, { params }: { params: Promise<{ tournamentId: string }> }) {
  try {
    const admin = await requireAdmin();
    const { tournamentId } = await params;
    const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true, startersPerTeam: true, maxSubstitutes: true } });
    if (!tournament) return NextResponse.json({ error: 'TOURNAMENT_NOT_FOUND' }, { status: 404 });
    const registrations = await prisma.tournamentRegistration.findMany({ where: { tournamentId, status: 'APPROVED' }, include: { roster: true } });
    for (const registration of registrations) {
      const starters = registration.roster.filter((member) => member.isStarter).length;
      const substitutes = registration.roster.length - starters;
      if (starters !== tournament.startersPerTeam || substitutes > tournament.maxSubstitutes) return NextResponse.json({ error: 'ROSTER_DOES_NOT_MATCH_TOURNAMENT_CONFIGURATION' }, { status: 409 });
    }
    await prisma.$transaction(async (tx) => {
      await tx.tournamentRegistration.updateMany({ where: { tournamentId, status: 'APPROVED' }, data: { rosterLockedAt: new Date() } });
      await tx.tournament.update({ where: { id: tournamentId }, data: { status: 'ROSTER_LOCKED' } });
    });
    await writeAudit({ actorId: admin.id, action: 'ROSTERS_LOCKED', entityType: 'Tournament', entityId: tournamentId, tournamentId, metadata: { approvedTeams: registrations.length } });
    return NextResponse.json({ status: 'ROSTERS_LOCKED', approvedTeams: registrations.length });
  } catch (error) {
    const result = authError(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
