import Link from 'next/link';
import RankEmblem from '@/app/rank-emblem';
import { getRankForNr } from '@/lib/ranks';

type TopPlayer = {
  nickname: string;
  currentNr: number;
  verifiedMatches: number;
  user: { publicNmdId: string; profile: { avatarUrl: string | null } | null };
};

export default function TopPlayers({ players }: { players: TopPlayer[] }) {
  return <section className="results-panel results-panel-players" aria-labelledby="top-players-heading">
    <header className="results-panel-header"><div><p className="results-eyebrow">LEADERBOARD</p><h2 id="top-players-heading">Top players</h2></div><Link href="/leaderboard" className="results-view-all">View all <span aria-hidden="true">→</span></Link></header>
    <div className="results-column-labels" aria-hidden="true"><span>#</span><span>PLAYER</span><span>RANK</span><span>RATING</span><span>MATCHES</span></div>
    <div className="top-player-list">{players.length === 0 ? <p className="results-empty">No players recorded yet.</p> : players.map((player, index) => { const rank = getRankForNr(player.currentNr); return <Link className={`top-player-row top-player-place-${index + 1}`} href={`/player/${player.user.publicNmdId}`} key={player.user.publicNmdId}><span className="top-player-position">{index + 1}</span>{player.user.profile?.avatarUrl ? <span className="results-avatar results-avatar-image" style={{ backgroundImage: `url(${player.user.profile.avatarUrl})` }} /> : <span className="results-avatar">{player.nickname.slice(0, 1).toUpperCase()}</span>}<span className="top-player-identity"><strong>{player.nickname}</strong><small>{rank.name}</small></span><span className="top-player-rank"><RankEmblem tier={rank.tier} size={34} /></span><span className="top-player-rating">{player.currentNr.toLocaleString()}</span><span className="top-player-matches">{player.verifiedMatches}</span></Link>; })}</div>
  </section>;
}
