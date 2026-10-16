'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import RankBanner from './RankBanner';
import { getLeaderboard, type LeaderboardPlayer } from '@/lib/api';
import { ranks } from './rank-data';

export default function LiveLeaderboard() {
  const [players, setPlayers] = useState<LeaderboardPlayer[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getLeaderboard(controller.signal).then(setPlayers).catch((reason: unknown) => {
      if ((reason as { name?: string })?.name !== 'AbortError') setError(true);
    });
    return () => controller.abort();
  }, []);

  return <section className="content-card"><div className="section-title"><h2>Season 01 leaderboard</h2><span className="eyebrow">LIVE BACKEND DATA</span></div>{error ? <div className="notice">The leaderboard is temporarily unavailable. No sample players are shown when the backend cannot be reached.</div> : players === null ? <div className="api-state">Loading verified players…</div> : players.length === 0 ? <div className="api-state">No verified players found.</div> : <div className="table-scroll"><table className="table"><thead><tr><th>#</th><th>PLAYER</th><th>RANK</th><th>NR</th><th>MATCHES</th></tr></thead><tbody>{players.map((player) => { const visualRank = ranks[player.mongolianRank.tier - 1] ?? ranks[0]; return <tr key={player.nmdId}><td>{player.rank}</td><td><Link href={`/player/${player.nmdId}`}><b>{player.nickname}</b></Link><small className="player-id">{player.nmdId}</small></td><td className="rank-table-cell"><RankBanner rank={visualRank} size="small" /><span>{player.mongolianRank.name}</span></td><td className="gold">{player.currentNr.toLocaleString()}</td><td>{player.verifiedMatches}</td></tr>; })}</tbody></table></div>}</section>;
}
