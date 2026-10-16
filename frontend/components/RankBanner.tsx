import type { Rank } from './rank-data';

function motif(rank: Rank) {
  if (rank.motif === 'dot') return <circle cx="50" cy="60" r="8" fill="#f8e6b2" />;
  if (rank.motif === 'two') return <><circle cx="40" cy="60" r="4.5" fill="#f8e6b2" /><circle cx="60" cy="60" r="4.5" fill="#f8e6b2" /></>;
  if (rank.motif === 'nine') return <>{[37, 50, 63].flatMap((y) => [37, 50, 63].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="4.5" fill="#f8e6b2" />))}</>;
  if (rank.motif === 'bars') return <>{[34, 45, 56, 67].map((x) => <rect key={x} x={x} y="40" width="6" height="43" fill="#f8e6b2" />)}</>;
  if (rank.motif === 'mountain') return <><path d="M26 78 50 28 74 78Z" fill="none" stroke="#fff2cc" strokeWidth="4" /><path d="M36 63h28M42 51h16" stroke="#fff2cc" strokeWidth="4" /></>;
  if (rank.motif === 'flame') return <path d="M51 26C39 45 30 52 30 66c0 15 9 25 21 25 14 0 23-11 23-25 0-12-10-23-23-40Z" fill="#f9f5e8" />;
  if (rank.motif === 'sun') return <><>{Array.from({ length: 8 }, (_, i) => { const angle = i * Math.PI / 4; return <circle key={i} cx={50 + 23 * Math.cos(angle)} cy={60 + 23 * Math.sin(angle)} r="6" fill="#f8d06a" />; })}</><circle cx="50" cy="60" r="9" fill="#f8d06a" /></>;
  if (rank.motif === 'star') return <><path d="M50 30 58 51 79 60 58 68 50 89 42 68 21 60 42 51Z" fill="#f8e6b2" /><circle cx="50" cy="60" r="7" fill="#1b2530" /></>;
  return <><circle cx="50" cy="60" r="24" fill="none" stroke="#fff0ba" strokeWidth="4" /><path d="M50 38C43 51 36 58 36 67a14 14 0 0 0 28 0c0-9-7-16-14-29Z" fill="#fff0ba" /></>;
}

export default function RankBanner({ rank, size = 'standard' }: { rank: Rank; size?: 'standard' | 'small' }) {
  return <svg className={`rank-banner rank-banner-${size}`} viewBox="0 0 100 130" role="img" aria-label={`${rank.name} banner`}>
    <path d="M50 8V126" stroke="#d9ad5c" strokeWidth="2" /><path d="M10 16H90" stroke="#f4ca79" strokeWidth="4" strokeLinecap="round" />
    <path d="M14 22H44L50 14L56 22H86V91L50 115L14 91Z" fill={rank.color} stroke="#e9c17a" strokeWidth="3" />
    <path d="M20 29H80V87L50 107L20 87Z" fill="none" stroke="#fff2ce" strokeOpacity=".55" strokeWidth="1.3" /><path d="M25 35H75" stroke="#fff2ce" strokeOpacity=".25" />
    {motif(rank)}<circle cx="50" cy="126" r="3" fill="#e9c17a" />
  </svg>;
}
