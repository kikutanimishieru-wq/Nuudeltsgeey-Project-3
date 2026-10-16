const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const teamNames = [
  ['Steppe Wolves', 'SW'], ['Blue Falcons', 'BF'], ['Khan Legion', 'KL'], ['Nomad Core', 'NC'],
  ['Tengri Five', 'TF'], ['Gobi Strikers', 'GS'], ['Orkhon Unit', 'OU'], ['Altai Rush', 'AR'],
];
const csRoles = ['IGL', 'AWPer', 'Rifler', 'Entry', 'Support'];

async function getOrCreatePlayer(number, passwordHash) {
  const email = `demo.player${String(number).padStart(2, '0')}@nuudeltsgeey.local`;
  const existing = await prisma.user.findUnique({ where: { email }, include: { profile: true } });
  if (existing) return existing.profile;
  const user = await prisma.user.create({
    data: {
      email, passwordHash, accountStatus: 'VERIFIED', publicNmdId: `NMD-${String(number).padStart(6, '0')}`,
      identity: { create: { legalName: `Demo Player ${number}`, phone: `+9767000${String(number).padStart(4, '0')}` } },
      profile: { create: { nickname: `DemoPlayer${number}`, csRole: csRoles[(number - 1) % csRoles.length], identityRole: 'Soldier', currentNr: 1000, floor: 1 } },
    },
    include: { profile: true },
  });
  return user.profile;
}

async function main() {
  if (process.env.SEED_DEMO !== 'true') throw new Error('Refusing to seed without SEED_DEMO=true');
  const passwordHash = await bcrypt.hash('DemoPass123!', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@nuudeltsgeey.local' },
    update: { role: 'SUPER_ADMIN', accountStatus: 'ACTIVE' },
    create: { email: 'admin@nuudeltsgeey.local', passwordHash, role: 'SUPER_ADMIN', accountStatus: 'ACTIVE', publicNmdId: 'NMD-999999' },
  });
  const cafe = await prisma.cafe.findFirst({ where: { name: 'Ikh Zasag Gaming Cafe' } }) || await prisma.cafe.create({ data: { name: 'Ikh Zasag Gaming Cafe', district: 'Bayanzurkh' } });

  const players = [];
  for (let number = 1; number <= 40; number += 1) players.push(await getOrCreatePlayer(number, passwordHash));

  const teams = [];
  for (let teamIndex = 0; teamIndex < teamNames.length; teamIndex += 1) {
    const firstPlayerIndex = teamIndex * 5;
    const captain = players[firstPlayerIndex];
    const team = await prisma.team.upsert({
      where: { name: teamNames[teamIndex][0] },
      update: { tag: teamNames[teamIndex][1], cafeId: cafe.id, captainId: captain.id },
      create: { name: teamNames[teamIndex][0], tag: teamNames[teamIndex][1], cafeId: cafe.id, captainId: captain.id },
    });
    for (const player of players.slice(firstPlayerIndex, firstPlayerIndex + 5)) {
      const membership = await prisma.teamMembership.findFirst({ where: { teamId: team.id, playerId: player.id, leftAt: null } });
      if (!membership) await prisma.teamMembership.create({ data: { teamId: team.id, playerId: player.id, isStarter: true } });
      await prisma.playerProfile.update({ where: { id: player.id }, data: { currentTeamId: team.id, homeCafeId: cafe.id } });
    }
    teams.push(team);
  }

  let tournament = await prisma.tournament.findFirst({ where: { name: 'Nuudeltsgeey Tournament #001' } });
  if (!tournament) {
    tournament = await prisma.tournament.create({
      data: {
        name: 'Nuudeltsgeey Tournament #001', venue: 'Ikh Zasag Gaming Cafe', game: 'Counter-Strike 2',
        format: 'SINGLE_ELIMINATION', style: 'OPEN_BRACKET', capacity: 8, teamSize: 5, startersPerTeam: 5,
        maxSubstitutes: 1, rulesVersion: '1.0', status: 'REGISTRATION_OPEN',
        startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), cafeId: cafe.id,
      },
    });
  }

  for (const team of teams) {
    const registration = await prisma.tournamentRegistration.upsert({
      where: { tournamentId_teamId: { tournamentId: tournament.id, teamId: team.id } },
      update: { status: 'APPROVED' }, create: { tournamentId: tournament.id, teamId: team.id, status: 'APPROVED' },
    });
    const members = await prisma.teamMembership.findMany({ where: { teamId: team.id, leftAt: null }, select: { playerId: true } });
    for (const member of members) {
      await prisma.tournamentRosterMember.upsert({
        where: { registrationId_playerId: { registrationId: registration.id, playerId: member.playerId } },
        update: { isStarter: true, acceptedAt: new Date() },
        create: { registrationId: registration.id, playerId: member.playerId, isStarter: true, acceptedAt: new Date() },
      });
    }
  }

  const achievementDefinitions = [
    ['FIRST_STEP', 'First Step', 'Complete the first verified match.'], ['FIRST_BLOOD', 'First Blood', 'Win the first verified match.'],
    ['VETERAN', 'Veteran', 'Complete 10 verified matches.'], ['BATTLE_TESTED', 'Battle Tested', 'Complete 25 verified matches.'],
    ['FIFTY_BATTLES', '50 Battles', 'Complete 50 verified matches.'], ['STREAK_III', 'Streak III', 'Win three matches consecutively.'],
    ['STREAK_V', 'Streak V', 'Win five matches consecutively.'], ['FINALIST', 'Finalist', 'Reach a tournament final.'],
    ['CHAMPION', 'Champion', 'Win an official tournament.'], ['KHAN', 'Khan', 'Reach 1,400 NR.'],
  ];
  for (const [kind, name, description] of achievementDefinitions) {
    await prisma.achievement.upsert({ where: { kind }, update: { name, description }, create: { kind, name, description } });
  }
  await prisma.identitySequence.upsert({ where: { id: 'public-nmd' }, update: {}, create: { id: 'public-nmd', nextValue: 41 } });
  const existingAudit = await prisma.auditEvent.findFirst({ where: { action: 'DEMO_SEED_CREATED', entityId: tournament.id } });
  if (!existingAudit) await prisma.auditEvent.create({ data: { actorId: admin.id, action: 'DEMO_SEED_CREATED', entityType: 'Tournament', entityId: tournament.id, tournamentId: tournament.id, metadata: { teams: teams.length, players: players.length, synthetic: true } } });
  console.log(JSON.stringify({ seeded: true, adminEmail: admin.email, demoPassword: 'DemoPass123!', tournamentId: tournament.id, teams: teams.length, players: players.length }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }).finally(() => prisma.$disconnect());
