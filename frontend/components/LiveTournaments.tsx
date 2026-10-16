'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getTournaments, type TournamentSummary } from '@/lib/api';

export default function LiveTournaments() {
  const [items, setItems] = useState<TournamentSummary[] | null>(null); const [error, setError] = useState(false);
  useEffect(() => { const controller = new AbortController(); getTournaments(controller.signal).then(setItems).catch((reason: unknown) => { if ((reason as { name?: string })?.name !== 'AbortError') setError(true); }); return () => controller.abort(); }, []);
  if (error) return <div className="notice">Tournament data is temporarily unavailable. No demo tournaments are shown.</div>;
  if (!items) return <div className="api-state">Loading tournaments…</div>;
  if (!items.length) return <div className="content-card"><div className="api-state">No public tournaments are available.</div></div>;
  return <div className="tournament-grid">{items.map((item, index) => <article className="event-card" key={item.id}><div className="event-art" style={{ backgroundPosition: `${30 + index * 25}% center` }}><span className="event-status">{item.status.replaceAll('_', ' ')}</span></div><div className="event-body"><h3>{item.name}</h3><div className="event-location">◷ {new Date(item.startsAt).toLocaleDateString()}</div><div className="event-meta"><span>♟ {item.format}</span><span>♙ {item._count.registrations} teams</span></div><div className="event-bottom"><strong>{item._count.matches} matches</strong><Link className="join" href={`/tournaments/${item.id}`}>View details →</Link></div></div></article>)}</div>;
}
