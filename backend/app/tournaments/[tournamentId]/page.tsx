import AttendanceActions from './AttendanceActions';
import { attendanceRuleVersion } from '@/lib/tournament-attendance-policy';
import { publicTournamentPolicy } from '@/lib/tournament-public';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import PublicNav from '../../public-nav';

export const dynamic = 'force-dynamic';

export default async function TournamentPage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId } = await params;
  const tournament = await prisma.tournament.findFirst({
    where: { id: tournamentId, status: { not: 'DRAFT' }, ...publicTournamentPolicy },
    select: { id: true, rulesVersion: true, name: true, venue: true, game: true, format: true, style: true, status: true, startsAt: true, registrations: { where: { status: 'APPROVED', withdrawnAt: null, disqualifiedAt: null }, orderBy: { team: { name: 'asc' } }, select: { id: true, team: { select: { id: true, name: true, tag: true } }, roster: { select: { isStarter: true, player: { select: { nickname: true, user: { select: { publicNmdId: true } } } } } } } }, matches: { orderBy: [{ round: 'asc' }, { bracketOrder: 'asc' }], select: { id: true, round: true, bracketOrder: true, status: true, result: true, winnerTeamId: true, teamAScore: true, teamBScore: true, teamA: { select: { id: true, name: true } }, teamB: { select: { id: true, name: true } } } } },
  });
  if (!tournament) notFound();
  return <main className="public-shell"><div className="public-wrap"><PublicNav /><header className="public-hero"><div className="public-eyebrow">TOURNAMENT DETAIL</div><h1>{tournament.name}</h1><p>{tournament.game} · {tournament.format} · {tournament.venue}</p><span className="public-pill">{tournament.status}</span></header>{tournament.rulesVersion === attendanceRuleVersion && <AttendanceActions tournamentId={tournament.id}/>}<section className="public-panel"><h2>Bracket</h2><div className="public-bracket">{['ROUND_OF_8', 'SEMIFINAL', 'FINAL'].map((round) => <div className="public-round" key={round}><h3>{round.replaceAll('_', ' ')}</h3>{tournament.matches.filter((match) => match.round === round).map((match) => <div className="public-match" key={match.id}><small>{match.status}</small><p>{match.teamA?.name ?? 'TBD'} {match.teamAScore !== null ? match.teamAScore : ''}</p><p>{match.teamB?.name ?? 'TBD'} {match.teamBScore !== null ? match.teamBScore : ''}</p></div>)}</div>)}</div></section><section className="public-panel"><h2>Approved teams</h2><div className="public-grid">{tournament.registrations.map((registration) => <article className="public-card" key={registration.id}><h3>{(registration.team?.name ?? 'Individual entrant')}</h3><p>{registration.team?.tag ?? '—'}</p>{registration.roster.map((member) => <p key={member.player.user.publicNmdId}><Link className="public-link" href={`/player/${member.player.user.publicNmdId}`}>{member.player.nickname}</Link>{member.isStarter ? '' : ' · substitute'}</p>)}</article>)}</div></section></div></main>;
}
