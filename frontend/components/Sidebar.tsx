import Link from 'next/link';
import { AuthNavigation } from './onboarding/AuthNavigation';

const links = [
  ['overview', '◈', 'Overview', '/'], ['tournaments', '⚑', 'Tournaments', '/tournaments'],
  ['leaderboard', '▥', 'Leaderboard', '/leaderboard'], ['clans', '⛨', 'Clans', '/clans'],
  ['watch', '▣', 'Watch live', '/watch'], ['badge', '✥', 'My badge', '/badge'],
  ['wallet', '▱', 'Wallet', '/wallet'], ['economy', '◈', 'Token economy', '/economy'],
  ['rules', '▦', 'Competition rules', '/rules'],
] as const;

export default function Sidebar({ page = 'Overview', open, onNavigate }: { page?: string; open: boolean; onNavigate: () => void }) {
  const activeKey = page.toLowerCase().replaceAll(' ', '');
  const active = ({ mybadge: 'badge', tokeneconomy: 'economy', watchlive: 'watch', competitionrules: 'rules' } as Record<string, string>)[activeKey] ?? (activeKey || 'overview');
  return <aside className={`sidebar ${open ? 'open' : ''}`} id="sidebar">
    <Link className="brand" href="/"><img src="/nuudeltsgeey-logo.webp" alt="Nuudeltsgeey logo" /><span>NUUDELTSGEEY<small>COMPETITIVE ARENA</small></span></Link>
    <div className="region"><span className="live" />MONGOLIA<span>MN ↗</span></div>
    <div className="nav-label">THE ARENA</div>
    <nav className="side-nav">{links.slice(0, 5).map(([key, icon, label, href]) => <Link className={active === key ? 'active' : ''} href={href} onClick={onNavigate} key={key}><b>{icon}</b> {label}{key === 'tournaments' && <small>03</small>}</Link>)}<div className="nav-label">YOUR IDENTITY</div>{links.slice(5).map(([key, icon, label, href]) => <Link className={active === key ? 'active' : ''} href={href} onClick={onNavigate} key={key}><b>{icon}</b> {label}</Link>)}</nav>
    <div className="sidebar-bottom"><div className="season-card"><span className="eyebrow">THE NEXT CHAPTER</span><h3>A new season.<br />A new legacy.</h3><p>Nuudeltsgeey Season 01 is live.</p><Link href="/leaderboard" onClick={onNavigate}>Explore the ladder ↗</Link></div><AuthNavigation sidebar onNavigate={onNavigate} /></div>
  </aside>;
}
