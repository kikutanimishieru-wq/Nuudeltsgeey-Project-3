import Link from 'next/link';

type MatchRow = {
  id: string;
  status: string;
  teamAScore: number | null;
  teamBScore: number | null;
  lockedAt: Date | null;
  teamA: { name: string; tag: string | null } | null;
  teamB: { name: string; tag: string | null } | null;
};

function TeamMark({ team }: { team: MatchRow['teamA'] }) {
  const label = team?.tag || team?.name.slice(0, 2).toUpperCase() || '—';
  return <span className="match-team-mark" title={team?.name || 'Team'}>{label}</span>;
}

export default function RecentMatches({ matches }: { matches: MatchRow[] }) {
  return <section className="results-panel results-panel-matches" aria-labelledby="recent-matches-heading">
    <header className="results-panel-header"><div><p className="results-eyebrow">VERIFIED HISTORY</p><h2 id="recent-matches-heading">Recent matches</h2></div><Link href="/tournaments" className="results-view-all">View all <span aria-hidden="true">→</span></Link></header>
    <div className="results-match-labels" aria-hidden="true"><span>MATCH</span><span>SCORE</span><span>STATUS</span><span>DATE</span></div>
    <div className="recent-match-list">{matches.length === 0 ? <p className="results-empty">No matches recorded yet.</p> : matches.map((match) => <div className="recent-match-row" key={match.id}><div className="recent-match-teams"><span><TeamMark team={match.teamA} /><strong>{match.teamA?.name || 'TBD'}</strong></span><b>vs</b><span><TeamMark team={match.teamB} /><strong>{match.teamB?.name || 'TBD'}</strong></span></div><strong className="recent-match-score">{match.teamAScore ?? '—'} — {match.teamBScore ?? '—'}</strong><span className="recent-match-status status-verified">VERIFIED</span><time className="recent-match-date" dateTime={match.lockedAt?.toISOString()}>{match.lockedAt ? match.lockedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</time></div>)}</div>
  </section>;
}
