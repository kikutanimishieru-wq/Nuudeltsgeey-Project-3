const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const HISTORY_NAME = 'Nuudeltsgeey Showcase Cup — Demo Match History';

const fixtureDefinitions = [
  { round: 'ROUND_OF_8', bracketOrder: 0, a: 0, b: 1, aScore: 13, bScore: 7 },
  { round: 'ROUND_OF_8', bracketOrder: 1, a: 2, b: 3, aScore: 13, bScore: 9 },
  { round: 'ROUND_OF_8', bracketOrder: 2, a: 4, b: 5, aScore: 13, bScore: 11 },
  { round: 'ROUND_OF_8', bracketOrder: 3, a: 6, b: 7, aScore: 13, bScore: 8 },
  { round: 'SEMIFINAL', bracketOrder: 0, a: 0, b: 2, aScore: 13, bScore: 10 },
  { round: 'SEMIFINAL', bracketOrder: 1, a: 4, b: 6, aScore: 13, bScore: 11 },
  { round: 'FINAL', bracketOrder: 0, a: 0, b: 4, aScore: 13, bScore: 9 },
];

async function main() {
  if (process.env.SEED_DEMO_HISTORY !== 'true') {
    throw new Error('Refusing to seed demo history without SEED_DEMO_HISTORY=true');
  }

  const admin = await prisma.user.findUnique({ where: { email: 'admin@nuudeltsgeey.local' } });
  const cafe = await prisma.cafe.findFirst({ where: { name: 'Ikh Zasag Gaming Cafe' } });
  const teamNames = ['Steppe Wolves', 'Blue Falcons', 'Khan Legion', 'Nomad Core', 'Tengri Five', 'Gobi Strikers', 'Orkhon Unit', 'Altai Rush'];
  const teams = await Promise.all(teamNames.map((name) => prisma.team.findUnique({ where: { name } })));
  if (!admin || !cafe || teams.some((team) => !team)) throw new Error('Run the main demo seed before seeding match history');

  const existing = await prisma.tournament.findFirst({ where: { name: HISTORY_NAME } });
  const tournament = existing || await prisma.tournament.create({
    data: {
      name: HISTORY_NAME,
      venue: 'Ikh Zasag Gaming Cafe',
      game: 'Counter-Strike 2',
      format: 'SINGLE_ELIMINATION',
      style: 'SHOWCASE_HISTORY',
      capacity: 8,
      teamSize: 5,
      startersPerTeam: 5,
      maxSubstitutes: 1,
      rulesVersion: '1.0-demo',
      status: 'COMPLETED',
      startsAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      cafeId: cafe.id,
    },
  });

  await prisma.$transaction(async (tx) => {
    for (const team of teams) {
      const registration = await tx.tournamentRegistration.upsert({
        where: { tournamentId_teamId: { tournamentId: tournament.id, teamId: team.id } },
        update: { status: 'APPROVED', rosterLockedAt: tournament.createdAt },
        create: { tournamentId: tournament.id, teamId: team.id, status: 'APPROVED', rosterLockedAt: tournament.createdAt },
      });
      const members = await tx.teamMembership.findMany({ where: { teamId: team.id, leftAt: null }, select: { playerId: true } });
      await tx.tournamentRosterMember.createMany({
        data: members.map(({ playerId }) => ({ registrationId: registration.id, playerId, isStarter: true, acceptedAt: tournament.createdAt })),
        skipDuplicates: true,
      });
    }

    for (const fixture of fixtureDefinitions) {
      const teamA = teams[fixture.a];
      const teamB = teams[fixture.b];
      const match = await tx.match.upsert({
        where: { tournamentId_round_bracketOrder: { tournamentId: tournament.id, round: fixture.round, bracketOrder: fixture.bracketOrder } },
        update: { teamAId: teamA.id, teamBId: teamB.id },
        create: { tournamentId: tournament.id, round: fixture.round, bracketOrder: fixture.bracketOrder, teamAId: teamA.id, teamBId: teamB.id, status: 'PENDING' },
      });

      const members = await tx.teamMembership.findMany({
        where: { teamId: { in: [teamA.id, teamB.id] }, leftAt: null },
        select: { teamId: true, playerId: true },
      });
      await tx.matchParticipant.createMany({
        data: members.map((member) => ({ matchId: match.id, teamId: member.teamId, playerId: member.playerId, isSubstitute: false })),
        skipDuplicates: true,
      });
      if (await tx.rankingEvent.findUnique({ where: { matchId: match.id } })) continue;

      const profiles = await tx.playerProfile.findMany({ where: { id: { in: members.map((member) => member.playerId) } } });
      const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
      const averageA = profiles.filter((profile) => members.find((member) => member.playerId === profile.id && member.teamId === teamA.id)).reduce((sum, profile) => sum + profile.currentNr, 0) / 5;
      const averageB = profiles.filter((profile) => members.find((member) => member.playerId === profile.id && member.teamId === teamB.id)).reduce((sum, profile) => sum + profile.currentNr, 0) / 5;
      const rankingEvent = await tx.rankingEvent.create({ data: { matchId: match.id } });

      for (const member of members) {
        const profile = profileById.get(member.playerId);
        if (!profile) throw new Error(`Missing profile for ${member.playerId}`);
        const won = member.teamId === teamA.id;
        const beforeNr = profile.currentNr;
        const delta = won ? 12 : 0; // Win base + participation; floor 1 protects demo losses.
        const afterNr = beforeNr + delta;
        const currentStreak = won ? profile.currentStreak + 1 : 0;
        await tx.ratingTransaction.create({ data: { rankingEventId: rankingEvent.id, playerId: profile.id, type: 'MATCH_RESULT', delta, beforeNr, afterNr, note: 'Synthetic investor demo match' } });
        await tx.playerNrSnapshot.create({ data: { matchId: match.id, playerId: profile.id, nr: afterNr } });
        await tx.playerProfile.update({ where: { id: profile.id }, data: { currentNr: afterNr, verifiedMatches: { increment: 1 }, wins: { increment: won ? 1 : 0 }, losses: { increment: won ? 0 : 1 }, currentStreak, bestStreak: Math.max(profile.bestStreak, currentStreak) } });
      }

      await tx.match.update({
        where: { id: match.id },
        data: { status: 'LOCKED', result: 'WIN', winnerTeamId: teamA.id, teamAScore: fixture.aScore, teamBScore: fixture.bScore, submittedAt: tournament.createdAt, lockedAt: tournament.createdAt },
      });
    }

    if (!await tx.auditEvent.findFirst({ where: { action: 'DEMO_HISTORY_CREATED', entityId: tournament.id } })) {
      await tx.auditEvent.create({ data: { actorId: admin.id, action: 'DEMO_HISTORY_CREATED', entityType: 'Tournament', entityId: tournament.id, tournamentId: tournament.id, metadata: { synthetic: true, matches: fixtureDefinitions.length } } });
    }
  }, { timeout: 60000 });

  console.log(JSON.stringify({ seeded: true, synthetic: true, tournament: HISTORY_NAME, matches: fixtureDefinitions.length }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }).finally(() => prisma.$disconnect());
