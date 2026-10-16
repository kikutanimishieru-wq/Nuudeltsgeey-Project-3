import Link from 'next/link';
import RankBanner from './RankBanner';
import { ranks } from './rank-data';

export default function RankHierarchy() {
  return <section className="panel rank-section"><div className="section-title"><div><div className="eyebrow">PATH OF THE KHAN</div><h2>From recruit to Great Khan</h2></div><Link href="/leaderboard">View all ranks →</Link></div><div className="rank-scroll"><div className="rank-strip">{ranks.map((rank) => <article className="rank-card" key={rank.tier}><RankBanner rank={rank} /><h3>{rank.name}</h3><p>{rank.englishName}</p><small>Tier {rank.tier}</small></article>)}</div></div></section>;
}
