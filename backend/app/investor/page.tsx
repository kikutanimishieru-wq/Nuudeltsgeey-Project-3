import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import PublicNav from '../public-nav';

export const dynamic = 'force-dynamic';

export default async function InvestorDemoPage() {
  const [players, teams, tournaments, lockedMatches] = await Promise.all([
    prisma.playerProfile.count({ where: { user: { accountStatus: { in: ['VERIFIED', 'ACTIVE'] } } } }),
    prisma.team.count(),
    prisma.tournament.count({ where: { status: { not: 'DRAFT' } } }),
    prisma.match.count({ where: { status: 'LOCKED' } }),
  ]);

  return <main className="public-shell"><div className="public-wrap"><PublicNav /><header className="public-hero public-hero-large"><div className="public-eyebrow">INVESTOR DEMO · NUUDELTSGEEY</div><h1>Competitive identity<br /><span>built for Mongolia.</span></h1><p>A working tournament operations platform connecting players, teams, cafés, rankings, and verified match history.</p><div className="public-actions"><Link className="public-button public-button-primary" href="/tournaments">Open live tournament</Link><Link className="public-button" href="/admin">Open operations center</Link></div></header><section className="public-stat-grid"><div className="public-stat"><span>PUBLIC PLAYERS</span><strong>{players}</strong></div><div className="public-stat"><span>TEAMS</span><strong>{teams}</strong></div><div className="public-stat"><span>TOURNAMENTS</span><strong>{tournaments}</strong></div><div className="public-stat"><span>LOCKED RESULTS</span><strong>{lockedMatches}</strong></div></section><section className="public-grid public-home-panels"><article className="public-card public-feature-card"><span className="public-eyebrow">01 · IDENTITY</span><h2>Every player has a public record</h2><p>Server-issued NMD IDs, public profiles, ranked history, and private identity fields kept separate.</p></article><article className="public-card public-feature-card"><span className="public-eyebrow">02 · OPERATIONS</span><h2>Built for real tournament work</h2><p>Check-in, roster locking, system-owned brackets, result verification, audit events, and advancement.</p></article><article className="public-card public-feature-card"><span className="public-eyebrow">03 · MOAT</span><h2>Mongolian competitive culture</h2><p>A recognizable rank hierarchy and visual language designed for local players, cafés, and communities.</p></article></section><section className="public-panel"><div className="public-section-heading"><div><div className="public-eyebrow">DEMO ROUTE</div><h2>Show this sequence</h2></div></div><ol className="public-demo-list"><li><Link className="public-link" href="/">Homepage and Mongolian rank identity</Link></li><li><Link className="public-link" href="/leaderboard">Leaderboard and NR progression</Link></li><li><Link className="public-link" href="/tournaments">Tournament and bracket results</Link></li><li><Link className="public-link" href="/player/NMD-000011">Player history and rating transaction</Link></li><li><Link className="public-link" href="/admin">Protected tournament operations</Link></li></ol></section></div></main>;
}
