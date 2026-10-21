'use client';
import Link from 'next/link';
import { mockPresentation } from '@/lib/mock-auth';
import { useMockAuth } from './MockAuthProvider';

export function AuthNavigation({ sidebar = false, onNavigate }: { sidebar?: boolean; onNavigate?: () => void }) {
  const { state, dispatch } = useMockAuth(); const player = mockPresentation(state);
  return <div className={`mock-account-nav ${sidebar ? 'is-sidebar' : ''}`} lang="mn">
    <Link className={sidebar ? 'account' : 'mock-account-link'} href={player.signedIn ? '/account' : '/login'} onClick={onNavigate}>
      {player.signedIn && <span className="avatar" aria-hidden="true">M</span>}
      <span>{player.signedIn ? player.nickname : 'Нэвтрэх'}<small>Демо · бодит сесс биш</small></span>
    </Link>
    {player.signedIn && <button type="button" className="demo-reset" onClick={() => { dispatch({ type: 'RESET' }); onNavigate?.(); }}>Демо гарах</button>}
  </div>;
}
