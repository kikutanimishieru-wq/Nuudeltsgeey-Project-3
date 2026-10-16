import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import RankEmblem from '../../rank-emblem';
import { getRankForNr } from '@/lib/ranks';
import PublicNav from '../../public-nav';

export const dynamic = 'force-dynamic';

export default async function PublicPlayerPage({ params }: { params: Promise<{ nmdId: string }> }) {
  const { nmdId } = await params;
  const player = await prisma.user.findUnique({
    where: {
      publicNmdId: nmdId,
      accountStatus: { in: ['VERIFIED', 'ACTIVE', 'UNDER_REVIEW', 'SUSPENDED', 'BADGE_REVOKED'] },
    },
    select: {
      publicNmdId: true,
      accountStatus: true,
      profile: {
        select: {
          nickname: true,
          csRole: true,
          currentNr: true,
          wins: true,
          losses: true,
          currentStreak: true,
          bestStreak: true,
          currentTeam: { select: { name: true } },
          matchParticipants: {
            where: { match: { status: 'LOCKED' } },
            orderBy: { match: { lockedAt: 'desc' } },
            select: {
              team: { select: { name: true, tag: true } },
              match: {
                select: {
                  id: true,
                  round: true,
                  result: true,
                  winnerTeamId: true,
                  teamAScore: true,
                  teamBScore: true,
                  lockedAt: true,
                  tournament: { select: { id: true, name: true } },
                  teamA: { select: { id: true, name: true } },
                  teamB: { select: { id: true, name: true } },
                },
              },
            },
          },
          ratingTransactions: {
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: { type: true, delta: true, beforeNr: true, afterNr: true, note: true, createdAt: true },
          },
        },
      },
    },
  });

  if (!player?.profile) notFound();
  const rank = getRankForNr(player.profile.currentNr);

  return <main className="public-shell"><div className="public-wrap"><PublicNav /><header className="public-profile-hero"><div><div className="public-eyebrow">PLAYER PROFILE · {player.publicNmdId}</div><h1>{player.profile.nickname}</h1><p>{player.profile.currentTeam?.name ?? 'Independent'} · {player.profile.csRole ?? 'Role not set'}</p><span className="public-pill">{player.accountStatus}</span></div><div className="public-profile-emblem"><RankEmblem tier={rank.tier} size={96} /><div><h2>{rank.name}</h2><p>{rank.englishName} · Tier {rank.tier}</p></div></div></header><section className="public-stat-grid"><div className="public-stat"><span>NUUDELTSGEEY RATING</span><strong>{player.profile.currentNr.toLocaleString()}</strong></div><div className="public-stat"><span>RECORD</span><strong>{player.profile.wins} W — {player.profile.losses} L</strong></div><div className="public-stat"><span>CURRENT STREAK</span><strong>{player.profile.currentStreak}</strong></div><div className="public-stat"><span>BEST STREAK</span><strong>{player.profile.bestStreak}</strong></div></section><section className="public-panel"><div className="public-section-heading"><div><div className="public-eyebrow">VERIFIED COMPETITIVE RECORD</div><h2>Match history</h2></div><span className="public-muted">{player.profile.matchParticipants.length} locked matches</span></div>{player.profile.matchParticipants.length === 0 ? <p className="public-muted">No locked matches yet.</p> : <div className="public-history-list">{player.profile.matchParticipants.map(({ team, match }) => <div className="public-history-row" key={match.id}><div><strong>{match.tournament.name}</strong><small>{match.round} · {team.name}</small></div><div className="public-history-score"><strong>{match.teamA?.name ?? 'TBD'} {match.teamAScore ?? '—'} — {match.teamB?.name ?? 'TBD'} {match.teamBScore ?? '—'}</strong><small>{match.result ?? 'Result pending'}</small></div></div>)}</div>}</section><section className="public-panel"><div className="public-section-heading"><div><div className="public-eyebrow">NR MOVEMENT</div><h2>Rating history</h2></div></div>{player.profile.ratingTransactions.length === 0 ? <p className="public-muted">No rating transactions yet.</p> : <div className="public-history-list">{player.profile.ratingTransactions.map((transaction, index) => <div className="public-history-row" key={`${transaction.createdAt.toISOString()}-${index}`}><div><strong>{transaction.type}</strong><small>{transaction.note ?? 'System rating update'}</small></div><div className="public-history-score"><strong className={transaction.delta >= 0 ? 'public-positive' : 'public-negative'}>{transaction.delta >= 0 ? '+' : ''}{transaction.delta} NR</strong><small>{transaction.beforeNr} → {transaction.afterNr}</small></div></div>)}</div>}</section></div></main>;
}
