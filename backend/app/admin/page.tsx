import Link from 'next/link';
import Image from 'next/image';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import AdminActions from './AdminActions';
import RegistrationAction from './RegistrationAction';
import MatchResultForm from './MatchResultForm';
import RankEmblem from '../rank-emblem';
import { mongolianRanks } from '@/lib/ranks';
import './admin.css';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/admin/login');
  try { await requireAdmin(); } catch { redirect('/admin/login'); }
  const [tournament, playerCount, teamCount, tournamentCount, matchCount] = await Promise.all([
    prisma.tournament.findFirst({
      orderBy: { createdAt: 'desc' },
      include: {
        cafe: true,
        registrations: { include: { team: true, roster: { include: { player: { include: { user: true } } } } }, orderBy: { team: { name: 'asc' } } },
        matches: { include: { teamA: true, teamB: true }, orderBy: [{ round: 'asc' }, { bracketOrder: 'asc' }] },
      },
    }),
    prisma.playerProfile.count({ where: { user: { accountStatus: { in: ['VERIFIED', 'ACTIVE'] } } } }),
    prisma.team.count(),
    prisma.tournament.count({ where: { status: { not: 'DRAFT' } } }),
    prisma.match.count(),
  ]);
  if (!tournament) return <main className="admin-shell"><div className="admin-wrap"><h1>No tournament found</h1></div></main>;
  const checkedIn = tournament.registrations.filter((registration) => ['PRESENT', 'LATE'].includes(registration.checkInStatus)).length;
  const locked = tournament.registrations.filter((registration) => registration.rosterLockedAt).length;

  return <main className="admin-shell"><div className="admin-dashboard-shell">
    <aside className="admin-sidebar"><Link className="admin-brand" href="/"><Image className="admin-brand-logo" src="/nuudeltsgeey-logo.webp" alt="Nuudeltsgeey imperial gold logo" width={38} height={38} priority /><span>NUUDELTSGEEY</span></Link><div className="admin-sidebar-label">OPERATIONS</div><nav className="admin-sidebar-nav"><Link className="active" href="/admin">▣ <span>Dashboard</span></Link><Link href="#tournament-operations">♜ <span>Tournaments</span></Link><Link href="#registrations">▤ <span>Registrations</span></Link><Link href="#bracket">⚔ <span>Matches</span></Link><Link href="/leaderboard">♙ <span>Players</span></Link><Link href="/leaderboard">♟ <span>Teams</span></Link><Link href="/leaderboard">✥ <span>Rankings</span></Link><Link href="#verification">◈ <span>Results verification</span></Link><Link className="planned" href="#planned">⊘ <span>Banlist</span><small>Planned</small></Link><Link className="planned" href="#planned">⚙ <span>Settings</span><small>Planned</small></Link></nav><div className="admin-sidebar-footer">SERVER RECORD<br /><strong>LIVE · POSTGRESQL</strong></div></aside>
    <section className="admin-main"><header className="admin-topbar"><div><div className="admin-eyebrow">MONGOLIAN CS2 ESPORTS PLATFORM</div><h1>Dashboard</h1><p>Overview of tournaments, players, and system activity.</p></div><div className="admin-topbar-actions"><span className="admin-user-chip">A</span><span>{session.user.email}</span><form action="/api/auth/logout" method="post"><button className="admin-link" type="submit">Sign out</button></form></div></header>
      <section className="admin-grid admin-metric-grid"><div className="admin-stat"><span>PLAYERS</span><strong>{playerCount}</strong><small>Verified public records</small></div><div className="admin-stat"><span>TEAMS</span><strong>{teamCount}</strong><small>Registered teams</small></div><div className="admin-stat"><span>TOURNAMENTS</span><strong>{tournamentCount}</strong><small>Published events</small></div><div className="admin-stat"><span>MATCHES</span><strong>{matchCount}</strong><small>System records</small></div></section>
      <section className="admin-overview-grid"><div className="admin-panel admin-feature-panel"><div className="admin-panel-header"><div><div className="admin-eyebrow">CURRENT TOURNAMENT</div><h2>{tournament.name}</h2><div className="admin-muted">{tournament.game} · {tournament.format} · {tournament.venue}</div></div><span className="admin-status">{tournament.status}</span></div><div className="admin-feature-meta"><span>◷ {tournament.startsAt ? tournament.startsAt.toLocaleDateString() : 'Schedule pending'}</span><span>♙ {tournament.registrations.length}/{tournament.capacity} teams</span><span>⚔ {tournament.matches.length} matches</span></div><AdminActions tournamentId={tournament.id} status={tournament.status} configurationOnly={Boolean(tournament.configurationPolicy)} /></div><div className="admin-panel"><div className="admin-panel-header"><h3>Recent registrations</h3><span className="admin-muted">{tournament.registrations.length} total</span></div><div className="admin-registration-list">{tournament.registrations.slice(0, 6).map((registration) => <div className="admin-registration-row" key={registration.id}><span className="admin-team-mark">{(registration.team?.name ?? 'Individual entrant').slice(0, 1)}</span><span><strong>{(registration.team?.name ?? 'Individual entrant')}</strong><small>{registration.roster.length}/5 players</small></span><b>{registration.status}</b></div>)}</div></div></section>
      <section className="admin-panel admin-ranking-panel"><div className="admin-panel-header"><div><div className="admin-eyebrow">RANKING OVERVIEW</div><h3>Mongolian rank hierarchy</h3></div><Link className="admin-link" href="/leaderboard">Manage ranks →</Link></div><div className="admin-rank-overview">{mongolianRanks.map((rank) => <div className="admin-rank-card" key={rank.tier}><RankEmblem tier={rank.tier} size={42} /><strong>{rank.name}</strong><small>T{rank.tier}</small></div>)}</div></section>
      <section className="admin-panel" id="tournament-operations"><div className="admin-panel-header"><div><h3>Tournament operations</h3><div className="admin-muted">Check-in, roster locks, and system-owned actions.</div></div><span className="admin-status">{checkedIn} checked in · {locked} locked</span></div></section>
      <section className="admin-panel" id="registrations"><h3>Registrations and rosters</h3><div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>TEAM</th><th>STATUS</th><th>CHECK-IN</th><th>ROSTER</th><th>ACTION</th></tr></thead><tbody>{tournament.registrations.map((registration) => <tr key={registration.id}><td><strong>{(registration.team?.name ?? 'Individual entrant')}</strong><small>{registration.team?.tag || '—'} · {registration.roster.length} players</small></td><td>{registration.status}</td><td>{registration.checkInStatus}</td><td>{registration.rosterLockedAt ? 'LOCKED' : 'OPEN'}</td><td>{!registration.rosterLockedAt && <RegistrationAction tournamentId={tournament.id} registrationId={registration.id} />}</td></tr>)}</tbody></table></div><p className="admin-muted">Check-in actions update the server record and audit log.</p></section>
      <section className="admin-panel" id="bracket"><h3>Bracket and match operations</h3>{tournament.matches.length === 0 ? <p className="admin-muted">{tournament.configurationPolicy ? 'Configuration only. Competitive operations await the later approved phases.' : 'Lock all eligible rosters, then generate the system-owned bracket.'}</p> : <div className="admin-bracket">{['ROUND_OF_8', 'SEMIFINAL', 'FINAL'].map((round) => <div className="admin-round" key={round}><h4>{round.replaceAll('_', ' ')}</h4>{tournament.matches.filter((match) => match.round === round).map((match) => <div className="admin-match" key={match.id}><small>Match {match.bracketOrder + 1} · {match.status}</small><p>{match.teamA?.name || 'TBD'}</p><p>{match.teamB?.name || 'TBD'}</p>{match.status === 'READY' && match.teamAId && match.teamBId && match.teamA && match.teamB && <MatchResultForm matchId={match.id} teamAId={match.teamAId} teamBId={match.teamBId} teamAName={match.teamA.name} teamBName={match.teamB.name} />}</div>)}</div>)}</div>}</section>
      <section className="admin-panel" id="verification"><div className="admin-panel-header"><div><div className="admin-eyebrow">MATCH VERIFICATION</div><h3>Recent match records</h3></div><span className="admin-muted">{tournament.matches.length} total</span></div>{tournament.matches.length === 0 ? <p className="admin-empty-state">No match records are available yet.</p> : <div className="admin-verification-list">{tournament.matches.slice(0, 8).map((match) => <div className="admin-verification-row" key={match.id}><div><strong>{match.teamA?.name || 'TBD'} <span>vs</span> {match.teamB?.name || 'TBD'}</strong><small>{match.round.replaceAll('_', ' ')} · Match {match.bracketOrder + 1}</small></div><b>{match.teamAScore ?? '—'} — {match.teamBScore ?? '—'}</b><span className={`admin-verification-status admin-verification-${match.status.toLowerCase()}`}>{match.status}</span></div>)}</div>}</section>
      <section className="admin-panel" id="planned"><h3>Workflow readiness</h3><p className="admin-muted">Captain result submissions, disputes, verification review, banlist, and settings are retained as planned until their approved rules are defined. Admin result locking remains available above.</p></section>
    </section>
  </div></main>;
}
