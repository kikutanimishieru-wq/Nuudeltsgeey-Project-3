'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RegistrationAction({ tournamentId, registrationId }: { tournamentId: string; registrationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function checkIn() {
    setBusy(true);
    await fetch(`/api/admin/tournaments/${tournamentId}/registrations/${registrationId}/check-in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'PRESENT' }) });
    setBusy(false);
    router.refresh();
  }
  return <button className="admin-button" type="button" onClick={checkIn} disabled={busy}>{busy ? 'Saving…' : 'Check in'}</button>;
}
