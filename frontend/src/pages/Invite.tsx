import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { auth } from '../api/auth';
import { ErrorNotice, Skeleton } from '../components/ui';

/**
 * Where a parent sets their own password — both for a new account and for
 * "forgot password".
 *
 * There is no mailer in this stack and none is needed: Cloudflare Access
 * already gates this origin, so anyone who can open this page has proven
 * control of an approved email. The link is issued by the other parent from
 * Account → Parents, is single-use, and expires after seven days. Nobody ever
 * types a password on someone else's behalf.
 */
export default function Invite() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [holder, setHolder] = useState<{ username: string; displayName: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .inviteHolder(token)
      .then(setHolder)
      .catch((e: unknown) =>
        setLinkError((e as Error)?.message || 'This link is not valid.'),
      )
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirmPassword) return setError('The two passwords do not match.');

    setBusy(true);
    try {
      const out = await api.redeemInvite(token, password);
      // Redeeming signs them straight in — no second login step.
      auth.set(out.token);
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setError((e as Error)?.message || 'Could not set the password. Ask for a new link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 380 }}>
        <div className="brand" style={{ marginBottom: 16 }}>
          Home<span>Guardian</span>
        </div>

        {loading && <Skeleton rows={3} height={18} />}

        {linkError && (
          <>
            <ErrorNotice message={linkError} />
            <div className="muted" style={{ fontSize: 13 }}>
              Ask the other parent to open <strong>Account → Parents</strong> and send
              you a new link.
            </div>
          </>
        )}

        {holder && !linkError && (
          <form onSubmit={submit} className="grid" style={{ gap: 12 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                Set a password for {holder.displayName || holder.username}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                You will sign in as <code>{holder.username}</code>. Only you will know
                this password.
              </div>
            </div>

            {error && <ErrorNotice message={error} onDismiss={() => setError(null)} />}

            <input
              type="password"
              placeholder="New password (at least 8 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
            />
            <input
              type="password"
              placeholder="Type it again"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
            <button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Set password and sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
