const baseUrl = (process.env.DEMO_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

async function check(path, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`);
  if (response.status !== expectedStatus) throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}`);
  return response;
}

async function main() {
  await check('/');
  await check('/leaderboard');
  await check('/tournaments');
  await check('/investor');
  const health = await (await check('/api/health')).json();
  if (health.status !== 'ok') throw new Error('Health endpoint did not report ok');

  const leaderboard = await (await check('/api/leaderboard?limit=3')).json();
  if (!Array.isArray(leaderboard.leaderboard)) throw new Error('Leaderboard payload is invalid');

  const tournaments = await (await check('/api/tournaments')).json();
  if (!Array.isArray(tournaments.tournaments)) throw new Error('Tournament payload is invalid');
  if (tournaments.tournaments[0]) {
    await check(`/api/tournaments/${tournaments.tournaments[0].id}`);
  }

  await check('/api/players/NMD-000011/history');
  console.log(`Demo smoke check passed against ${baseUrl}`);
}

main().catch((error) => {
  console.error(`Demo smoke check failed: ${error.message}`);
  process.exitCode = 1;
});
