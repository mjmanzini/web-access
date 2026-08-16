import { useEffect, useState } from 'react';
import { api } from '../api/client';
import Parents from '../components/Parents';

const MIN_LENGTH = 8; // matches the backend's ChangePasswordDto

/**
 * VAPID keys travel as base64url; PushManager wants raw bytes. Built on an
 * explicit ArrayBuffer so the result satisfies BufferSource.
 */
function urlBase64ToBytes(base64: string): BufferSource {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Phone notifications for the installed dashboard.
 *
 * Only offered when the browser can actually do it: push needs a service
 * worker and a secure context, so on an un-installed iOS browser the controls
 * would be a dead end. Says why rather than failing silently.
 */
function PushNotifications() {
  const [cfg, setCfg] = useState<{ enabled: boolean; publicKey: string | null; devices: number } | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    window.isSecureContext;

  const refresh = async () => {
    try {
      setCfg(await api.pushConfig());
      if (supported) {
        const reg = await navigator.serviceWorker.getRegistration();
        setSubscribed(!!(await reg?.pushManager.getSubscription()));
      }
    } catch {
      /* config is parent-only; a failure here just hides the panel */
    }
  };
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enable = async () => {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setErr('Notifications were blocked. Allow them for this site in your browser settings.');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(cfg!.publicKey!),
      });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api.pushSubscribe({ endpoint: json.endpoint, keys: json.keys });
      setSubscribed(true);
      setMsg('This device will now get alerts.');
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not enable notifications.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api.pushUnsubscribe(sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setMsg('This device will no longer get alerts.');
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not turn notifications off.');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setErr('');
    try {
      const { delivered } = await api.pushTest();
      setMsg(delivered ? `Test sent to ${delivered} device${delivered === 1 ? '' : 's'}.` : 'No subscribed devices yet.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send a test.');
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) return null;

  return (
    <div className="card" style={{ maxWidth: 420, marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <strong>Phone notifications</strong>
        <span className="badge muted">{cfg.devices} device{cfg.devices === 1 ? '' : 's'}</span>
      </div>

      {!cfg.enabled ? (
        <div className="muted" style={{ fontSize: 13 }}>
          Not configured on the server. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env to
          enable push.
        </div>
      ) : !supported ? (
        <div className="muted" style={{ fontSize: 13 }}>
          This browser can’t receive push here. On iPhone, add Home Guardian to your Home Screen
          first, then open it from there.
        </div>
      ) : (
        <>
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Get the same alerts as Discord on this phone — new devices, bypass attempts, and when
            something goes offline.
          </div>
          <div className="row">
            {subscribed ? (
              <button className="ghost" onClick={disable} disabled={busy}>
                {busy ? '…' : 'Turn off on this device'}
              </button>
            ) : (
              <button onClick={enable} disabled={busy}>
                {busy ? '…' : 'Turn on for this device'}
              </button>
            )}
            <button className="ghost" onClick={test} disabled={busy || !cfg.devices}>
              Send test
            </button>
          </div>
        </>
      )}

      {msg && <div className="badge ok" style={{ marginTop: 12, display: 'block' }}>{msg}</div>}
      {err && <div className="badge danger" style={{ marginTop: 12, display: 'block' }}>{err}</div>}
    </div>
  );
}

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
    api.me()
      .then((u) => setUsername(u.username))
      // Not fatal: the page still works, the greeting just says less.
      .catch(() => setUsername(''));
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

      <PushNotifications />

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

      <Parents />
    </>
  );
}
