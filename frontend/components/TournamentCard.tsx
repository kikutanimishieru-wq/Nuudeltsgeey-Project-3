 'use client';

import { useState } from 'react';

type Tournament = { name: string; date: string; format: string; teams: string; status: string; position: string };

export default function TournamentCard({ tournament }: { tournament: Tournament }) {
  const [open, setOpen] = useState(false);
  return <><article className="event-card"><div className="event-art" style={{ backgroundPosition: `${tournament.position} center` }}><span className="event-status">{tournament.status}</span></div><div className="event-body"><h3>{tournament.name}</h3><div className="event-location">◷ {tournament.date}</div><div className="event-meta"><span>♟ {tournament.format}</span><span>♙ {tournament.teams}</span></div><div className="event-bottom"><strong>Open event</strong><button className="join" onClick={() => setOpen(true)}>View details →</button></div></div></article>{open && <div className="demo-modal" role="dialog" aria-modal="true" aria-label={`${tournament.name} preview`}><div className="demo-modal-card"><button className="demo-modal-close" aria-label="Close tournament preview" onClick={() => setOpen(false)}>×</button><span className="eyebrow">SAMPLE TOURNAMENT</span><h2>{tournament.name}</h2><p className="muted-copy">{tournament.date} · {tournament.format} · {tournament.teams}</p><p className="muted-copy">This is a visual preview. Registration and tournament operations are not connected.</p><button className="primary" onClick={() => setOpen(false)}>Close preview</button></div></div>}</>;
}
