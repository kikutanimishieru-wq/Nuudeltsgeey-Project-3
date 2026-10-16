import Link from 'next/link';

export default function Hero() {
  return <section className="hero"><div className="hero-content"><span className="hero-label">SEASON 01 / THE RISE OF THE NOMAD</span><h2>MONGOLIAN CS2.<br /><span>BUILT TO COMPETE.</span></h2><p>From your local café to the national stage.<br />Find your people. Earn your rank. Build your legacy.</p><div className="actions"><Link className="primary" href="#tournaments">Find a tournament ↗</Link><Link className="secondary" href="/leaderboard">Explore rankings</Link></div></div><span className="hero-caption">MONGOLIA · SERVER-VERIFIED FUTURE</span></section>;
}
