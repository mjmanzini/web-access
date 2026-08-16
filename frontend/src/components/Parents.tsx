import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ParentAccount } from '../api/types';
import { ErrorNotice, Skeleton, useConfirm } from './ui';

/**
 * Parent accounts — add a second parent, and hand out reset links.
 *
 * The "forgot password" story lives here rather than in an email. This stack
 * has no mailer, and adding one would buy less than it appears: Cloudflare
 * Access already gates this whole origin, so anyone who can reach the login
 * page has just proven control of an approved email address. A link handed over
 * by the other parent carries the same assurance with no third party, no API
 * key to leak, and it still works when the internet is down.
 */
export default function Parents() {
  const [me, setMe] = useState<{ id: string } | null>(null);
  const [accounts, setAccounts] = useState<ParentAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ label: string; url: string; expiresAt: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [form, setForm] = useState({ username: '', displayName: '', email: '' });
  const [copied, setCopied] = useState(false);
  const confirm = useConfirm();

  const load = () => {
    api
      .parentAccounts()
      .then(setAccounts)
      .catch((e: unknown) => {
        setAccounts([]);
        setError((e as Error)?.message || 'Could not load accounts.');
      });
  };

  useEffect(() => {
    load();
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

  const iAmAdmin = accounts?.find((a) => a.id === me?.id)?.role === 'admin';

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusyKey(key);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error)?.message || 'That did not work.');
    } finally {
      setBusyKey(null);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    return run('add', async () => {
      if (!form.username.trim()) throw new Error('Choose a username for the new parent.');
      const out = await api.createParent({
        username: form.username,
        displayName: form.displayName || undefined,
        email: form.email || undefined,
      });
      setLink({ label: form.displayName || form.username, url: out.url, expiresAt: out.expiresAt });
      setForm({ username: '', displayName: '', email: '' });
    });
  };

  const reset = (a: ParentAccount) =>
    run(`reset:${a.id}`, async () => {
      const out = await api.resetLinkFor(a.id);
      setLink({ label: a.displayName || a.username, url: out.url, expiresAt: out.expiresAt });
    });

  const remove = (a: ParentAccount) =>
    run(`del:${a.id}`, async () => {
      const ok = await confirm({
        title: `Remove ${a.displayName || a.username}?`,
        body: 'They lose access to the dashboard immediately. Devices and profiles are untouched.',
        confirmLabel: 'Remove access',
        danger: true,
      });
      if (!ok) return;
      await api.deleteParent(a.id);
    });

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false); // the URL is on screen and selectable either way
    }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Parents</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>
        Everyone here can sign in and control the household. Only an admin can add or
        remove accounts.
      </p>

      {error && <ErrorNotice message={error} onDismiss={() => setError(null)} />}

      {accounts === null ? (
        <Skeleton rows={2} height={20} />
      ) : (
        <div className="grid" style={{ gap: 10, marginBottom: 14 }}>
          {accounts.map((a) => (
            <div key={a.id} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, overflowWrap: 'anywhere' }}>
                  {a.displayName || a.username}{' '}
                  {a.role === 'admin' && <span className="badge muted">admin</span>}{' '}
                  {a.id === me?.id && <span className="badge ok">you</span>}
                </div>
                <div className="muted" style={{ fontSize: 11, overflowWrap: 'anywhere' }}>
                  {a.username}
                  {a.email ? ` · ${a.email}` : ''}
                  {!a.hasPassword ? ' · no password set yet' : ''}
                  {a.pendingInvite ? ' · link outstanding' : ''}
                </div>
              </div>
              {iAmAdmin && (
                <div className="row" style={{ gap: 6 }}>
                  <button
                    className="ghost"
                    onClick={() => reset(a)}
                    disabled={busyKey === `reset:${a.id}`}
                  >
                    {busyKey === `reset:${a.id}` ? '…' : 'Reset link'}
                  </button>
                  {a.id !== me?.id && (
                    <button
                      className="ghost"
                      onClick={() => remove(a)}
                      disabled={busyKey === `del:${a.id}`}
                    >
                      {busyKey === `del:${a.id}` ? '…' : 'Remove'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Shown once, here. The token is stored only as a hash, so this is the
          only moment it can be handed over. */}
      {link && (
        <div className="card" style={{ background: 'var(--panel-2)', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Link for {link.label}
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Open it on their phone — they choose their own password and are signed in.
            Single use, expires {new Date(link.expiresAt).toLocaleDateString()}.
          </div>
          <div className="row" style={{ gap: 8 }}>
            <code
              style={{
                flex: '1 1 180px',
                minWidth: 0,
                overflowWrap: 'anywhere',
                fontSize: 11,
                userSelect: 'all',
              }}
            >
              {link.url}
            </code>
            <button className="ghost" onClick={() => copy(link.url)}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button className="ghost" onClick={() => setLink(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      {iAmAdmin && (
        <form onSubmit={add} className="grid" style={{ gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Add a parent</div>
          <input
            placeholder="Username (e.g. maria)"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            autoCapitalize="none"
            autoCorrect="off"
          />
          <input
            placeholder="Name shown in the app (optional)"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
          <input
            type="email"
            placeholder="Email — for Cloudflare Access, never emailed (optional)"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            autoCapitalize="none"
            autoCorrect="off"
          />
          <button type="submit" disabled={busyKey === 'add'}>
            {busyKey === 'add' ? 'Creating…' : 'Create account + link'}
          </button>
          <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
            Their email must also be added to the Cloudflare Access policy for this
            dashboard, or they will never reach the sign-in page that sits behind it.
          </div>
        </form>
      )}
    </div>
  );
}
