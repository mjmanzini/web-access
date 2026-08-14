import { useState } from 'react';
import { api } from '../api/client';
import { auth } from '../api/auth';

/** Full-screen login gate shown whenever there is no valid session. */
export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { token } = await api.login(username, password);
      auth.set(token); // flips the app into the authed view
    } catch {
      setError('Invalid username or password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <form onSubmit={submit} className="card" style={{ width: 320 }}>
        <div className="brand" style={{ marginBottom: 18 }}>
          Home<span>Guardian</span>
        </div>
        <div className="grid" style={{ gap: 10 }}>
          <input
            placeholder="Username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <div className="badge danger">{error}</div>}
          <button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}
