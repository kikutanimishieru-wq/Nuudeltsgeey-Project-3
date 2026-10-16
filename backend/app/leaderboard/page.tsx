import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import PublicNav from '../public-nav';
import RankEmblem from '../rank-emblem';
import { getRankForNr } from '@/lib/ranks';

export const dynamic = 'force-dynamic';

export default async function LeaderboardPage() {
  const players = await prisma.playerProfile.findMany({
    where: { user: { accountStatus: { in: ['VERIFIED', 'ACTIVE'] } } },
    orderBy: [{ currentNr: 'desc' }, { nickname: 'asc' }],
    take: 100,
    select: { nickname: true, currentNr: true, floor: true, verifiedMatches: true, wins: true, losses: true, user: { select: { publicNmdId: true } } },
  });
  return <main className="public-shell"><div className="public-wrap"><PublicNav /><header className="public-hero"><div className="public-eyebrow">PUBLIC RANKING</div><h1>Leaderboard</h1><p>Verified competitive records ordered by current Nuudeltsgeey rating.</p></header><section className="public-panel"><table className="public-table"><thead><tr><th>RANK</th><th>PLAYER</th><th>NR</th><th>FLOOR</th><th>RECORD</th></tr></thead><tbody>{players.map((player, index) => { const rank = getRankForNr(player.currentNr); return <tr key={player.user.publicNmdId}><td>{index + 1}</td><td><div className="public-rank-cell"><RankEmblem tier={rank.tier} size={40} /><div><Link href={`/player/${player.user.publicNmdId}`}>{player.nickname}</Link><small>{rank.name} · {player.user.publicNmdId}</small></div></div></td><td><strong>{player.currentNr}</strong></td><td>{player.floor}</td><td>{player.wins} W — {player.losses} L · {player.verifiedMatches} matches</td></tr>; })}</tbody></table></section></div></main>;
}
