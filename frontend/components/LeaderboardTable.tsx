import Link from 'next/link';
import RankBanner from './RankBanner';
import { ranks } from './rank-data';

const players = [['Altai', '2,450', '120', 9], ['KhaanZ', '2,320', '98', 8], ['Saruul', '2,180', '110', 7], ['temkA', '2,050', '87', 6], ['Erdne', '1,980', '93', 5]] as const;

export default function LeaderboardTable() {
  return <section className="content-card"><div className="section-title"><h2>Season 01 leaderboard</h2><span className="eyebrow">SAMPLE DATA</span></div><table className="table"><thead><tr><th>#</th><th>PLAYER</th><th>RANK</th><th>NR</th><th>MATCHES</th></tr></thead><tbody>{players.map(([name, nr, matches, tier], index) => <tr key={name}><td>{index + 1}</td><td><Link href="#future"><b>{name}</b></Link></td><td className="rank-table-cell"><RankBanner rank={ranks[tier - 1]} size="small" /><span>{ranks[tier - 1].name}</span></td><td className="gold">{nr}</td><td>{matches}</td></tr>)}</tbody></table></section>;
}
