import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import PublicNav from './public-nav';
import RankEmblem from './rank-emblem';
import RankHierarchy from '@/components/RankHierarchy';
import TopPlayers from '@/components/TopPlayers';
import RecentMatches from '@/components/RecentMatches';
import { getRankForNr } from '@/lib/ranks';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const [players, tournaments, matches] = await Promise.all([
    prisma.playerProfile.findMany({
      where: { user: { accountStatus: { in: ['VERIFIED', 'ACTIVE'] } } },
      orderBy: [{ currentNr: 'desc' }, { nickname: 'asc' }],
      take: 5,
      select: { nickname: true, currentNr: true, wins: true, losses: true, verifiedMatches: true, user: { select: { publicNmdId: true, profile: { select: { avatarUrl: true } } } } },
    }),
    prisma.tournament.findMany({
      where: { status: { not: 'DRAFT' } },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
      take: 3,
      select: { id: true, name: true, game: true, format: true, status: true, venue: true, startsAt: true, _count: { select: { registrations: true, matches: true } } },
    }),
    prisma.match.findMany({
      where: { status: 'LOCKED' },
      orderBy: { lockedAt: 'desc' },
      take: 6,
      select: { id: true, status: true, teamAScore: true, teamBScore: true, lockedAt: true, teamA: { select: { name: true, tag: true } }, teamB: { select: { name: true, tag: true } } },
    }),
  ]);

  return <main className="public-shell public-home"><div className="public-wrap">
    <PublicNav />
    <section className="public-hero public-hero-large"><div className="public-eyebrow">MONGOLIAN CS2 COMPETITIVE PLATFORM</div><h1>MONGOLIAN CS2<br /><span>COMPETITIVE PLATFORM</span></h1><p>PLAY. COMPETE. BUILD YOUR NAME.</p><div className="public-actions"><Link className="public-button public-button-primary" href="/leaderboard">View rankings</Link><Link className="public-button" href="/tournaments">Tournaments</Link></div><div className="public-hero-note">SERVER-VERIFIED RECORDS · MONGOLIA</div></section>
    <RankHierarchy />
    <section className="public-home-panel public-upcoming-panel"><div className="public-section-heading"><div><div className="public-eyebrow">COMPETITION CALENDAR</div><h2>Upcoming tournaments</h2></div><Link className="public-link" href="/tournaments">View all →</Link></div><div className="public-upcoming-grid">{tournaments.length === 0 ? <p className="public-muted">No published tournaments yet.</p> : tournaments.map((tournament, index) => <Link className={`public-upcoming-card public-upcoming-card-${index + 1}`} href={`/tournaments/${tournament.id}`} key={tournament.id}><div className="public-upcoming-image"><span className={`public-upcoming-status public-upcoming-status-${tournament.status.toLowerCase()}`}>{tournament.status.replaceAll('_', ' ')}</span></div><div className="public-upcoming-body"><h3>{tournament.name}</h3><div className="public-upcoming-meta"><span>▣ {tournament.startsAt ? tournament.startsAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date pending'}</span><span>♟ {tournament.format}</span><span>♟ {tournament._count.registrations || 0} teams</span></div><span className="public-upcoming-button">View details <b>→</b></span></div></Link>)}</div></section>
    <section className="results-dashboard"><TopPlayers players={players} /><RecentMatches matches={matches} /></section>
  </div></main>;
}
