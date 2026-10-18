'use client';
import { useState } from 'react';
export default function IdentityActions({ signedIn }: { signedIn: boolean }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function start(provider: string, intent: 'LINK' | 'SIGN_IN') {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/identity/${provider}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intent, ...(intent === 'LINK' ? { password } : {}) }) });
      const data = await response.json();
      setPassword('');
      if (data.error === 'FRESH_AUTHENTICATION_REQUIRED') { setError('Enter your current account password to authorize linking.'); setBusy(false); return; }
      if (!response.ok || typeof data.url !== 'string') throw new Error('Identity verification is unavailable. Please try again or contact support.');
      window.location.assign(data.url);
    } catch { setError('Identity verification is unavailable. Please try again or contact support.'); setBusy(false); }
    finally { setPassword(''); }
  }
  return <>{signedIn && <label>Current account password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} required /></label>}<p>Both accounts must be verified before protected competition actions. Discord server membership is optional.</p>{(['steam', 'discord'] as const).map(provider => <p key={provider}><button className="admin-button" disabled={busy || (signedIn && !password)} onClick={() => start(provider, signedIn ? 'LINK' : 'SIGN_IN')}>{signedIn ? 'Link or reverify' : 'Sign in with'} {provider === 'steam' ? 'Steam' : 'Discord'}</button></p>)}{!signedIn && <p>First-time linking requires signing in to your existing registered account first. Provider sign-in does not create or merge accounts.</p>}{error && <p role="alert">{error}</p>}</>;
}
