import { useEffect, useState } from 'react';
import { api } from '../api/client';

const MIN_LENGTH = 8; // matches the backend's ChangePasswordDto

/** Account settings — currently just the signed-in parent's password. */
export default function Account() {
  const [username, setUsername] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.me().then((u) => setUsername(u.username)).catch(() => {});
  }, []);

  /** Client-side checks; the backend re-validates everything that matters. */
  const validate = () => {
    if (!currentPassword || !newPassword || !confirm) return 'Fill in all three fields.';
    if (newPassword.length < MIN_LENGTH) return `New password must be at least ${MIN_LENGTH} characters.`;
    if (newPassword !== confirm) return 'New passwords do not match.';
    if (newPassword === currentPassword) return 'New password must be different from the current one.';
    return '';
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setDone(false);

    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setDone(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (err) {
      // 401 here means the current password was wrong — the session survives.
      setError(err instanceof Error ? err.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="header"><h1>Account</h1></div>

      <div className="card" style={{ maxWidth: 420 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <strong>Change password</strong>
          {username && <span className="badge muted">{username}</span>}
        </div>

        <form onSubmit={submit} className="grid" style={{ gap: 10 }}>
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder={`New password (min ${MIN_LENGTH} characters)`}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />

          {error && <div className="badge danger">{error}</div>}
          {done && <div className="badge ok">Password changed. Use it the next time you sign in.</div>}

          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Change password'}
          </button>
        </form>

        <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
          This is the login for the dashboard itself. It is stored as a bcrypt hash — changing it
          here takes effect immediately and does not touch AUTH_ADMIN_PASSWORD in .env, which only
          seeds the first admin on a fresh database.
        </p>
      </div>
    </>
  );
}
