import Link from 'next/link';
import { mongolianRanks } from '@/lib/ranks';
import styles from './RankHierarchy.module.css';

const colors = ['#8d969d', '#816649', '#72804a', '#9d433e', '#216999', '#d3d8d8', '#c58a31', '#972f39', '#d5a52c'] as const;
const motifs = ['dot', 'two', 'nine', 'bars', 'mountain', 'flame', 'sun', 'star', 'crown'] as const;

export const rankTiers = mongolianRanks.map((rank, index) => ({
  id: rank.tier,
  mn: rank.name,
  en: rank.englishName,
  minimumNr: rank.minimumNr,
  color: colors[index],
  motif: motifs[index],
}));

type Motif = (typeof rankTiers)[number]['motif'];

function RankMotif({ type }: { type: Motif }) {
  const dots = (coords: [number, number][]) => coords.map(([x, y], index) => <circle key={index} cx={x} cy={y} r="4.5" fill="#f8e6b2" />);
  switch (type) {
    case 'dot': return <circle cx="50" cy="60" r="8" fill="#f8e6b2" />;
    case 'two': return dots([[40, 60], [60, 60]]);
    case 'nine': return dots([37, 50, 63].flatMap((y) => [37, 50, 63].map((x) => [x, y] as [number, number])));
    case 'bars': return <g fill="#f8e6b2">{[34, 45, 56, 67].map((x) => <rect key={x} x={x} y="40" width="6" height="43" />)}</g>;
    case 'mountain': return <g fill="none" stroke="#fff2cc" strokeWidth="4"><path d="M26 78 50 28 74 78Z" /><path d="M36 63h28M42 51h16" /></g>;
    case 'flame': return <path d="M51 26C39 45 30 52 30 66c0 15 9 25 21 25 14 0 23-11 23-25 0-12-10-23-23-40Z" fill="#f9f5e8" />;
    case 'sun': return <g fill="#f8d06a">{Array.from({ length: 8 }, (_, index) => { const angle = index * Math.PI / 4; return <circle key={index} cx={50 + 23 * Math.cos(angle)} cy={60 + 23 * Math.sin(angle)} r="6" />; })}<circle cx="50" cy="60" r="9" /></g>;
    case 'star': return <><path d="M50 30 58 51 79 60 58 68 50 89 42 68 21 60 42 51Z" fill="#f8e6b2" /><circle cx="50" cy="60" r="7" fill="#1b2530" /></>;
    case 'crown': return <g fill="none" stroke="#fff0ba" strokeWidth="4"><circle cx="50" cy="60" r="24" /><path d="M50 38C43 51 36 58 36 67a14 14 0 0 0 28 0c0-9-7-16-14-29Z" fill="#fff0ba" stroke="none" /></g>;
  }
}

export function RankBanner({ rank }: { rank: (typeof rankTiers)[number] }) {
  return <svg viewBox="0 0 100 130" className={styles.banner} role="img" aria-label={`${rank.mn} banner`}>
    <path d="M50 8V126" stroke="#d9ad5c" strokeWidth="2" />
    <path d="M10 16H90" stroke="#f4ca79" strokeWidth="4" strokeLinecap="round" />
    <path d="M14 22H44L50 14L56 22H86V91L50 115L14 91Z" fill={rank.color} stroke="#e9c17a" strokeWidth="3" />
    <path d="M20 29H80V87L50 107L20 87Z" fill="none" stroke="#fff2ce" strokeOpacity=".55" strokeWidth="1.3" />
    <path d="M25 35H75" stroke="#fff2ce" strokeOpacity=".25" />
    <RankMotif type={rank.motif} />
    <circle cx="50" cy="126" r="3" fill="#e9c17a" />
  </svg>;
}

export default function RankHierarchy() {
  return <section className={styles.section} aria-labelledby="ranking-heading">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>RANKING SYSTEM</p><h2 id="ranking-heading">From recruit to Great Khan</h2></div>
      <Link href="/leaderboard" className={styles.link}>View all ranks <span aria-hidden="true">→</span></Link>
    </header>
    <div className={styles.scroll}><div className={styles.grid}>{rankTiers.map((rank) => <article className={styles.card} key={rank.id}>
      <RankBanner rank={rank} />
      <h3>{rank.mn}</h3><p>{rank.en}</p><span>Tier {rank.id}</span>
    </article>)}</div></div>
  </section>;
}
