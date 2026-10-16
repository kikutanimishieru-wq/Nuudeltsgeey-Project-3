import { mongolianRanks } from '@/lib/ranks';

const bannerColors = ['#89939b', '#765d42', '#697538', '#963d35', '#1e6599', '#d8dde0', '#bd7d2e', '#8e2e2c', '#d39c32'];

export default function RankBanner({ tier, size = 66 }: { tier: number; size?: number }) {
  const safeTier = Math.min(mongolianRanks.length, Math.max(1, tier));
  const fabric = bannerColors[safeTier - 1];
  const metal = safeTier >= 7 ? '#f4c15d' : '#e1c98d';
  const ink = safeTier >= 5 ? '#f5f2e9' : '#f3e3b7';
  return <svg className="rank-banner" width={size} height={size * 1.2} viewBox="0 0 100 120" role="img" aria-label={`Tier ${safeTier} banner`}>
    <path d="M50 1 54 7h35v4h-5v75L50 109 16 86V11h-5V7h35z" fill="#201b14" stroke={metal} strokeWidth="2" />
    <path d="M50 4 53 10h29v72L50 102 18 82V10h29z" fill={fabric} stroke="#f5e6bd" strokeOpacity=".55" strokeWidth="1.5" />
    <path d="M23 16h54M23 21h54" stroke="#fff" strokeOpacity=".2" />
    <path d="M50 1v-6M46-5h8" stroke={metal} strokeWidth="2" />
    {safeTier === 1 && <circle cx="50" cy="52" r="8" fill={ink} />}
    {safeTier === 2 && <><circle cx="40" cy="52" r="7" fill={ink} /><circle cx="60" cy="52" r="7" fill={ink} /></>}
    {safeTier === 3 && <g fill={ink}>{[35,50,65].flatMap((x) => [38,53,68].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="4" />))}</g>}
    {safeTier === 4 && <g stroke={ink} strokeWidth="5"><path d="M34 35v36M45 35v36M56 35v36M67 35v36" /><path d="M28 77h44" stroke={metal} strokeWidth="3" /></g>}
    {safeTier === 5 && <path d="M50 28 75 78H25zM36 61h28M42 50h16M47 40h6" fill="none" stroke={ink} strokeWidth="5" />}
    {safeTier === 6 && <path d="M50 30c-12 17-18 25-18 34a18 18 0 0 0 36 0c0-9-6-17-18-34Zm0 19c-5 7-8 11-8 16a8 8 0 0 0 16 0c0-5-3-9-8-16Z" fill={ink} />}
    {safeTier === 7 && <g fill={metal}><circle cx="50" cy="56" r="8" fill={ink} />{[[50,35],[50,77],[30,56],[70,56],[36,42],[64,42],[36,70],[64,70]].map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="6" />)}</g>}
    {safeTier === 8 && <><path d="m50 27 7 20 20 7-20 7-7 20-7-20-20-7 20-7z" fill={ink} /><circle cx="50" cy="54" r="7" fill={fabric} /></>}
    {safeTier === 9 && <><circle cx="50" cy="56" r="23" fill="none" stroke={ink} strokeWidth="5" /><path d="M50 31v-10M50 91V81M25 56H14M86 56H75M32 38l-8-8M68 38l8-8M32 74l-8 8M68 74l8 8" stroke={metal} strokeWidth="3" /><path d="M50 41c-8 11-12 16-12 22a12 12 0 0 0 24 0c0-6-4-11-12-22Z" fill={ink} /></>}
    <path d="M50 105v14M46 119h8" stroke={metal} strokeWidth="2" />
  </svg>;
}
