'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TopBar } from '../../components/theme/TopBar';
import { api, loadStoredUser, type StoredUser } from '../../lib/user-session';
import { RemoteSessionView } from '../../components/remote/RemoteSessionView';

interface AnnounceResponse {
  remoteId: string;
  pin: string;
  sessionId: string;
  expiresAt: string;
}

function maskRemoteId(id: string) {
  return id.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
}
function fmtExpiry(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function RemotePageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get('sessionId')?.trim() || '';
  const [me, setMe] = useState<StoredUser | null>(null);
  const [ann, setAnn] = useState<AnnounceResponse | null>(null);
  const [busyAnn, setBusyAnn] = useState(false);
  const [partner, setPartner] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [busyConn, setBusyConn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const u = loadStoredUser();
    if (!u) { router.replace('/onboarding'); return; }
    setMe(u);
  }, [router]);

  if (sessionId) {
    return <RemoteSessionView sessionId={sessionId} />;
  }

  // Tick for the expiry countdown
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-clear announcement when it expires
  useEffect(() => {
    if (!ann) return;
    if (new Date(ann.expiresAt).getTime() <= now) setAnn(null);
  }, [ann, now]);

  const announce = async () => {
    setErr(null); setBusyAnn(true);
    try {
      const r = await api<AnnounceResponse>('/api/remote/announce', { method: 'POST', body: '{}' });
      setAnn(r);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusyAnn(false); }
  };
  const cancel = async () => {
    try { await api('/api/remote/cancel', { method: 'POST', body: '{}' }); } catch {}
    setAnn(null);
  };

  const connect = async () => {
    setErr(null);
    const id = partner.replace(/\s+/g, '');
    if (!/^\d{6,12}$/.test(id)) { setErr('Enter a valid Partner ID (6–12 digits).'); return; }
    if (!/^\d{6}$/.test(pinInput)) { setErr('PIN must be 6 digits.'); return; }
    setBusyConn(true);
    try {
      const r = await api<{ sessionId: string; host: { displayName: string } }>(
        '/api/remote/connect',
        { method: 'POST', body: JSON.stringify({ partnerId: id, pin: pinInput }) },
      );
      router.push(`/remote?sessionId=${encodeURIComponent(r.sessionId)}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusyConn(false); }
  };

  const copy = (v: string) => navigator.clipboard?.writeText(v).catch(() => {});

  return (
    <>
      <TopBar user={me ?? undefined} />
      <div className="remote-dash">
        <div className="container">
          {/* HOST CARD */}
          <section className="tv-card">
            <h3>Allow Remote Control</h3>
            <p style={{ color: 'var(--wa-muted)', fontSize: 13, marginBottom: 18 }}>
              Generate a one-time PIN and share it (with your ID) so a partner
              can take control of this device. The PIN expires in 5 minutes
              and works once.
            </p>

            {!ann && (
              <button className="btn-primary" onClick={announce} disabled={busyAnn}>
                {busyAnn ? 'Generating…' : '🔓 Generate PIN'}
              </button>
            )}

            {ann && (
              <>
                <div className="label">Your ID</div>
                <div className="tv-id">
                  <span>{maskRemoteId(ann.remoteId)}</span>
                  <button onClick={() => copy(ann.remoteId)}>Copy</button>
                </div>

                <div className="tv-divider" />

                <div className="label">One-time password</div>
                <div className="tv-id" style={{ fontSize: 24 }}>
                  <span className="tv-pin">{ann.pin}</span>
                  <button onClick={() => copy(ann.pin)}>Copy</button>
                  <button onClick={announce} title="Regenerate">↻</button>
                </div>

                <div className="tv-divider" />
                <div style={{ fontSize: 12, color: 'var(--wa-muted)' }}>
                  Expires in <strong style={{ color: 'var(--wa-text)' }}>{fmtExpiry(ann.expiresAt)}</strong>
                  {' · '}
                  <button onClick={cancel} style={{ color: 'var(--wa-muted)', textDecoration: 'underline' }}>
                    cancel
                  </button>
                </div>
              </>
            )}
          </section>

          {/* CONTROL CARD */}
          <section className="tv-card">
            <h3>Control Remote Computer</h3>
            <p style={{ color: 'var(--wa-muted)', fontSize: 13, marginBottom: 18 }}>
              Enter your partner&apos;s ID and the one-time password they gave
              you to start the session.
            </p>

            <div className="label">Partner ID</div>
            <input
              className="tv-input"
              inputMode="numeric"
              autoComplete="off"
              placeholder="123 456 789"
              value={partner}
              onChange={(e) => setPartner(e.target.value.replace(/[^\d ]/g, ''))}
            />

            <div className="label" style={{ marginTop: 14 }}>One-time password</div>
            <input
              className="tv-input"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              placeholder="••••••"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter') connect(); }}
            />

            {err && <div style={{ color: '#ef4f6c', fontSize: 13, marginTop: 10 }}>{err}</div>}

            <button className="btn-primary" onClick={connect} disabled={busyConn}>
              {busyConn ? 'Connecting…' : '→ Connect'}
            </button>
          </section>
        </div>
      </div>
    </>
  );
}

export default function RemoteDashPage() {
  return (
    <Suspense fallback={<div className="remote-dash"><div className="container"><section className="tv-card"><div className="muted">Loading…</div></section></div></div>}>
      <RemotePageInner />
    </Suspense>
  );
}
