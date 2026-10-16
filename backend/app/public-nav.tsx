import Link from 'next/link';
import Image from 'next/image';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getRankForNr } from '@/lib/ranks';
import RankEmblem from './rank-emblem';
import HeaderSearch from '@/components/HeaderSearch';

export default async function PublicNav() {
  const session = await auth();
  const player = session?.user?.publicNmdId ? await prisma.playerProfile.findUnique({ where: { userId: session.user.id }, select: { nickname: true, currentNr: true, user: { select: { publicNmdId: true, profile: { select: { avatarUrl: true } } } } } }) : null;
  const rank = player ? getRankForNr(player.currentNr) : null;
  return <nav className="public-nav"><Link className="public-brand" href="/"><Image className="public-brand-logo" src="/nuudeltsgeey-logo.webp" alt="Nuudeltsgeey imperial gold logo" width={56} height={56} priority /> <span>NUUDELTSGEEY</span></Link><div className="public-nav-links"><Link href="/">Home</Link><Link href="/leaderboard">Players</Link><Link href="/leaderboard">Ranking</Link><Link href="/tournaments">Tournaments</Link><Link href="/investor">Ikh Zasag</Link></div><details className="public-mobile-menu"><summary>Menu</summary><div><Link href="/">Home</Link><Link href="/leaderboard">Players</Link><Link href="/leaderboard">Ranking</Link><Link href="/tournaments">Tournaments</Link><Link href="/investor">Ikh Zasag</Link></div></details><div className="public-nav-actions"><HeaderSearch />{player && rank ? <details className="public-profile-menu"><summary><span className="public-nav-avatar" style={player.user.profile?.avatarUrl ? { backgroundImage: `url(${player.user.profile.avatarUrl})` } : undefined}>{player.nickname.slice(0, 1).toUpperCase()}</span><RankEmblem tier={rank.tier} size={28} /><span className="public-profile-menu-name">{player.nickname}</span><span aria-hidden="true">⌄</span></summary><div className="public-profile-menu-panel"><Link href={`/player/${player.user.publicNmdId}`}>{rank.name} · {player.currentNr.toLocaleString()} NR</Link><Link href={`/player/${player.user.publicNmdId}`}>View profile</Link><form action="/api/auth/logout" method="post"><button type="submit">Sign out</button></form></div></details> : <><Link className="public-nav-signin" href="/admin/login">Sign In</Link><Link className="public-nav-register" href="/admin/login">Register</Link></>}</div></nav>;
}
