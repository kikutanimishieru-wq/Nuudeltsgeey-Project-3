'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminActions({ tournamentId, status, configurationOnly = false }: { tournamentId: string; status: string; configurationOnly?: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function post(path: string, body?: unknown) {
    setBusy(true);
    setMessage('Working…');
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setMessage(data.error || 'Operation failed.'); return; }
    setMessage(data.status || 'Operation complete.');
    router.refresh();
  }

  if (configurationOnly) return <p className="admin-muted">Configuration draft: registration, roster lock and bracket generation are unavailable.</p>;
  return <div><div className="admin-actions">
    <button className="admin-button" disabled={busy} onClick={() => post(`/api/admin/tournaments/${tournamentId}/lock-rosters`)}>Lock rosters</button>
    <button className="admin-button" disabled={busy || status !== 'ROSTER_LOCKED'} onClick={() => post(`/api/admin/tournaments/${tournamentId}/generate-bracket`)}>Generate bracket</button>
  </div>{message && <div className="admin-message">{message}</div>}</div>;
}
