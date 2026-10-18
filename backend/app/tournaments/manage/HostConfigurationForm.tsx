'use client';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
type Draft = { id: string; name: string; status: string; format: string; capacity: number; managedByCurrentConfiguration: boolean; startsAt?: string | null; readinessBlockers?: string[] };
export default function HostConfigurationForm() {
  const [drafts, setDrafts] = useState<Draft[]>([]); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function refresh() {
    const response = await fetch('/api/tournaments/mine', { cache: 'no-store' });
    if (!response.ok) throw new Error('Sign in to view your tournament drafts.');
    setDrafts((await response.json()).tournaments);
  }
  useEffect(() => { refresh().catch(() => setMessage('Sign in to view your tournament drafts.')); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    const form = event.currentTarget; const input = new FormData(form);
    try {
      const response = await fetch('/api/tournaments', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: input.get('name'), venue: input.get('venue'), format: input.get('format'), capacity: Number(input.get('capacity')), style: 'Open Bracket', entryFee: 0, startsAt: new Date(String(input.get('startsAt'))).toISOString() }) });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error === 'HOSTING_LIMIT_REACHED' ? 'Three hosting slots are reserved. Archive an unused draft to free a slot.' : data.error === 'COMPETITIVE_IDENTITY_REQUIRED' ? 'Verify both Steam and Discord and complete account eligibility before hosting.' : 'The tournament draft could not be created. Sign in and check your configuration.');
        return;
      }
      form.reset(); await refresh(); setMessage('Draft saved. Open registration when you are ready to publish the scheduled event.');
    } catch { setMessage('The request could not be completed. Refresh your drafts before retrying.'); }
    finally { setBusy(false); }
  }
  async function archive(id: string) {
    setBusy(true); setMessage('');
    try { const response = await fetch(`/api/tournaments/${encodeURIComponent(id)}/archive`, { method: 'POST' });
      if (!response.ok) throw new Error(); await refresh(); setMessage('Draft archived. Its history is preserved and its hosting slot is released.');
    } catch { setMessage('The draft could not be archived.'); } finally { setBusy(false); }
  }
  async function open(id: string) {
    setBusy(true);setMessage('');
    try {const response=await fetch(`/api/tournaments/${encodeURIComponent(id)}/open-registration`,{method:'POST'});const data=await response.json();if(!response.ok)throw new Error('Registration could not be opened. Check your verified identity, scheduled start and whether this draft already has published rules.');await refresh();setMessage('Registration opened. It closes 15 minutes before the scheduled start.');}
    catch(error){setMessage(error instanceof Error ? error.message : 'Registration could not be opened.');}finally{setBusy(false);}
  }
  return <><section className="public-panel"><h2>Create a tournament draft</h2><p>Free entry · Open Bracket · maximum three reserved hosting slots, including drafts.</p><form onSubmit={submit}>
    <p><label>Tournament name <input name="name" minLength={3} maxLength={100} required /></label></p>
    <p><label>Venue <input name="venue" minLength={3} maxLength={160} required /></label></p>
    <p><label>Format <select name="format">{['1v1','2v2','3v3','5v5'].map(format => <option key={format}>{format}</option>)}</select></label></p>
    <p><label>Entrant capacity <select name="capacity" defaultValue="16">{[2,4,8,16,32,64].map(capacity => <option key={capacity}>{capacity}</option>)}</select></label></p>
    <p><label>Scheduled start <input name="startsAt" type="datetime-local" required /></label> · Your device time zone; stored as UTC.</p>
    <p>Entrants are individual players in 1v1 and teams in team formats. A draft does not open registration. Each team format allows one optional registered substitute.</p>
    <p>Grand Battle classification is automatic at 64+ distinct verified eligible active starters. Capacity alone does not establish that status. Final classification awaits checked-in, locked rosters.</p>
    <button className="public-link" disabled={busy}>Save configuration</button></form><p role="status">{message}</p></section>
    <section className="public-panel"><h2>Your tournaments</h2>{drafts.length ? <div className="public-grid">{drafts.map(draft => <article className="public-card" key={draft.id}><span className="public-pill">{draft.status}</span><h3>{draft.name}</h3><p>{draft.format} · {draft.capacity} {draft.format === '1v1' ? 'players' : 'teams'}</p><p>Scheduled start: {draft.startsAt ? new Date(draft.startsAt).toISOString() : 'Not scheduled'}</p>{draft.managedByCurrentConfiguration && <p>Free entry · final classification pending</p>}{draft.managedByCurrentConfiguration && draft.status === 'DRAFT' && draft.startsAt && <button className="public-link" disabled={busy} onClick={() => open(draft.id)}>Open registration</button>}{draft.status !== 'DRAFT' && <p><Link className="public-link" href={`/tournaments/${draft.id}`}>View tournament</Link></p>}{draft.managedByCurrentConfiguration && draft.status === 'DRAFT' && <button className="public-link" disabled={busy} onClick={() => archive(draft.id)}>Archive unused draft</button>}</article>)}</div> : <p>No owned tournament configurations recorded.</p>}</section></>;
}
