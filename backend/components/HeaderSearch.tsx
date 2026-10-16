'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

type TeamResult = { id: string; name: string; tag: string | null; cafe: { name: string } | null };
type PlayerResult = { nmdId: string; nickname: string; currentNr: number };

export default function HeaderSearch() {
  const [query, setQuery] = useState('');
  const [teams, setTeams] = useState<TeamResult[]>([]);
  const [players, setPlayers] = useState<PlayerResult[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setTeams([]);
      setPlayers([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const [teamResponse, playerResponse] = await Promise.all([
          fetch(`/api/teams?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal }),
          fetch('/api/leaderboard?limit=100', { signal: controller.signal }),
        ]);
        if (!teamResponse.ok || !playerResponse.ok) return;
        const teamData = await teamResponse.json() as { teams: TeamResult[] };
        const playerData = await playerResponse.json() as { leaderboard: PlayerResult[] };
        const normalized = trimmed.toLowerCase();
        setTeams(teamData.teams.slice(0, 5));
        setPlayers(playerData.leaderboard.filter((player) => player.nickname.toLowerCase().includes(normalized) || player.nmdId.toLowerCase().includes(normalized)).slice(0, 5));
        setOpen(true);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setTeams([]);
        setPlayers([]);
      }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (query.trim()) setOpen(true);
  }

  const hasResults = teams.length > 0 || players.length > 0;
  return <div className="header-search-wrap">
    <form className="header-search" onSubmit={submit} role="search">
      <span aria-hidden="true">⌕</span>
      <input aria-label="Search players and teams" placeholder="Search players or teams" value={query} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
    </form>
    {open && query.trim().length >= 2 && <div className="header-search-results">
      {!hasResults && <p className="header-search-empty">No players or teams found.</p>}
      {players.length > 0 && <div><p className="header-search-label">PLAYERS</p>{players.map((player) => <Link className="header-search-result" href={`/player/${player.nmdId}`} key={player.nmdId} onClick={() => setOpen(false)}><span>{player.nickname}</span><small>{player.nmdId} · {player.currentNr.toLocaleString()} NR</small></Link>)}</div>}
      {teams.length > 0 && <div><p className="header-search-label">TEAMS</p>{teams.map((team) => <div className="header-search-result header-search-team" key={team.id}><span>{team.tag ? `[${team.tag}] ` : ''}{team.name}</span><small>{team.cafe?.name || 'Team record'}</small></div>)}</div>}
      <Link className="header-search-all" href="/leaderboard" onClick={() => setOpen(false)}>Browse all players →</Link>
    </div>}
  </div>;
}
