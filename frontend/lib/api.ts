export type ApiRank = { tier: number; name: string; englishName: string; minimumNr: number };

export type LeaderboardPlayer = {
  rank: number;
  nmdId: string;
  nickname: string;
  currentNr: number;
  floor: number;
  verifiedMatches: number;
  wins: number;
  losses: number;
  currentStreak: number;
  mongolianRank: ApiRank;
};

type LeaderboardResponse = { leaderboard: LeaderboardPlayer[] };

export type PlayerMatch = {
  id: string; round: number; status: string; result: string | null; winnerTeamId: string | null;
  teamAScore: number | null; teamBScore: number | null; lockedAt: string | null;
  tournament: { id: string; name: string } | null;
  teamA: { id: string; name: string; tag: string } | null;
  teamB: { id: string; name: string; tag: string } | null;
  playerTeam: { id: string; name: string; tag: string } | null;
};
export type PlayerProfile = { nmdId: string; nickname: string; currentNr: number; floor: number; verifiedMatches: number; wins: number; losses: number; currentStreak: number; mongolianRank: ApiRank; matches: PlayerMatch[]; ratingHistory: Array<{ type: string; delta: number; beforeNr: number; afterNr: number; note: string | null; createdAt: string }> };
export type TournamentSummary = { id: string; name: string; venue: string | null; game: string; format: string; style: string; capacity: number; teamSize: number; status: string; startsAt: string; cafe: { id: string; name: string; district: string } | null; _count: { registrations: number; matches: number } };
export type TournamentDetail = TournamentSummary & { startersPerTeam: number; maxSubstitutes: number; rulesVersion: string; registrations: Array<{ id: string; status: string; checkInStatus: string; rosterLockedAt: string | null; team: { id: string; name: string; tag: string }; roster: Array<{ isStarter: boolean; player: { nickname: string; user: { publicNmdId: string } } }> }>; matches: Array<{ id: string; round: number; bracketOrder: number; status: string; result: string | null; winnerTeamId: string | null; teamAScore: number | null; teamBScore: number | null; teamA: { id: string; name: string; tag: string } | null; teamB: { id: string; name: string; tag: string } | null }> };

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export async function getLeaderboard(signal?: AbortSignal): Promise<LeaderboardPlayer[]> {
  const response = await fetch(`${apiBaseUrl}/api/leaderboard?limit=100`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`LEADERBOARD_REQUEST_FAILED_${response.status}`);
  const payload = (await response.json()) as LeaderboardResponse;
  if (!Array.isArray(payload.leaderboard)) throw new Error('INVALID_LEADERBOARD_RESPONSE');
  return payload.leaderboard;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`API_REQUEST_FAILED_${response.status}`);
  return response.json() as Promise<T>;
}

export async function getPlayerProfile(nmdId: string, signal?: AbortSignal) { return (await getJson<{ player: PlayerProfile }>(`/api/players/${encodeURIComponent(nmdId)}/history`, signal)).player; }
export async function getTournaments(signal?: AbortSignal) { return (await getJson<{ tournaments: TournamentSummary[] }>('/api/tournaments', signal)).tournaments; }
export async function getTournament(id: string, signal?: AbortSignal) { return (await getJson<{ tournament: TournamentDetail }>(`/api/tournaments/${encodeURIComponent(id)}`, signal)).tournament; }
