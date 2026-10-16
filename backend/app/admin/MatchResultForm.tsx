'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function MatchResultForm({ matchId, teamAId, teamBId, teamAName, teamBName }: { matchId: string; teamAId: string; teamBId: string; teamAName: string; teamBName: string }) {
  const router = useRouter();
  const [winner, setWinner] = useState(teamAId);
  const [teamAScore, setTeamAScore] = useState('1');
  const [teamBScore, setTeamBScore] = useState('0');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMessage('Recording result…');
    const body = { teamAScore: Number(teamAScore), teamBScore: Number(teamBScore), result: 'WIN', winnerTeamId: winner };
    const recorded = await fetch(`/api/admin/matches/${matchId}/record-result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const recordedBody = await recorded.json().catch(() => ({}));
    if (!recorded.ok) { setMessage(recordedBody.error || 'Result could not be recorded.'); setBusy(false); return; }
    const locked = await fetch(`/api/admin/matches/${matchId}/lock-result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const lockedBody = await locked.json().catch(() => ({}));
    setBusy(false);
    if (!locked.ok) { setMessage(`Recorded, but not locked: ${lockedBody.error || 'ranking lock failed'}`); router.refresh(); return; }
    setMessage('Result locked and ranking updated.');
    router.refresh();
  }

  return <div className="admin-result-form"><div className="admin-result-fields"><label>{teamAName}<input type="number" min="0" value={teamAScore} onChange={(event) => setTeamAScore(event.target.value)} /></label><label>{teamBName}<input type="number" min="0" value={teamBScore} onChange={(event) => setTeamBScore(event.target.value)} /></label><label>Winner<select value={winner} onChange={(event) => setWinner(event.target.value)}><option value={teamAId}>{teamAName}</option><option value={teamBId}>{teamBName}</option></select></label></div><button className="admin-button" type="button" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Record and lock'}</button>{message && <small className="admin-muted">{message}</small>}</div>;
}
