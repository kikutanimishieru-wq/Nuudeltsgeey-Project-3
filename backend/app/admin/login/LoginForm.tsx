'use client';

import { FormEvent, useState } from 'react';

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!response.ok) {
      setError('Invalid admin credentials.');
      setLoading(false);
      return;
    }
    window.location.href = '/admin';
  }

  return (
    <form onSubmit={submit}>
      <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      {error && <div className="login-error">{error}</div>}
      <button className="admin-button" disabled={loading}>{loading ? 'SIGNING IN…' : 'SIGN IN'}</button>
    </form>
  );
}
