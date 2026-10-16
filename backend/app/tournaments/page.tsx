import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import PublicNav from '../public-nav';

export const dynamic = 'force-dynamic';

export default async function TournamentsPage() {
  const tournaments = await prisma.tournament.findMany({
    where: { status: { not: 'DRAFT' } }, orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, name: true, game: true, format: true, status: true, venue: true, startsAt: true, _count: { select: { registrations: true, matches: true } } },
  });
  return <main className="public-shell"><div className="public-wrap"><PublicNav /><header className="public-hero"><div className="public-eyebrow">COMPETITION ARCHIVE</div><h1>Tournaments</h1><p>Follow published events, registered teams, and verified bracket results.</p></header><div className="public-grid">{tournaments.map((tournament) => <Link className="public-card" href={`/tournaments/${tournament.id}`} key={tournament.id}><span className="public-pill">{tournament.status}</span><h2>{tournament.name}</h2><p>{tournament.game} · {tournament.format}</p><p>{tournament.venue} · {tournament._count.registrations} teams · {tournament._count.matches} matches</p></Link>)}</div></div></main>;
}
