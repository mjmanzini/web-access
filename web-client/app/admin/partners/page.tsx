'use client';

import { useEffect, useState } from 'react';
import { TopBar } from '../../../components/theme/TopBar';
import {
  listSafeSpots,
  type SafeSpot,
} from '../../../lib/khuloh/client';
import { loadStoredUser, signalingUrl } from '../../../lib/user-session';

const ADMIN_KEY_STORAGE = 'khuloh.adminKey';

/**
 * Partner admin console — manage Safe Spots and issue rotating QR tokens
 * for staff to print/display at venues. Gated by `KHULOH_ADMIN_KEY` on the
 * server (sent via `X-Khuloh-Admin-Key` header).
 *
 * The admin key is stored only in `sessionStorage` so closing the tab
 * clears it. It is never sent off-origin.
 */
export default function PartnerAdminPage() {
  const [adminKey, setAdminKey] = useState('');
  const [spots, setSpots] = useState<SafeSpot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Partial<SafeSpot> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.sessionStorage.getItem(ADMIN_KEY_STORAGE);
    if (stored) setAdminKey(stored);
    void refresh();
  }, []);

  function persistKey(k: string) {
    setAdminKey(k);
    try {
      if (k) window.sessionStorage.setItem(ADMIN_KEY_STORAGE, k);
      else window.sessionStorage.removeItem(ADMIN_KEY_STORAGE);
    } catch { /* private mode */ }
  }

  async function refresh() {
    const stored = loadStoredUser();
    if (!stored) { setError('Sign in first.'); return; }
    setLoading(true);
    setError(null);
    try {
      const list = await listSafeSpots(signalingUrl(), stored.token, {});
      setSpots(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveSpot(input: Partial<SafeSpot>) {
    if (!adminKey) { setError('Enter an admin key first.'); return; }
    setError(null);
    try {
      const method = input.id ? 'PATCH' : 'POST';
      const url = input.id
        ? `${signalingUrl()}/api/khuloh/safe-spots/${encodeURIComponent(input.id)}`
        : `${signalingUrl()}/api/khuloh/safe-spots`;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Khuloh-Admin-Key': adminKey },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `http_${res.status}`);
      }
      setEditing(null);
      void refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main style={{ padding: 16, maxWidth: 960, margin: '0 auto' }}>
      <TopBar />
      <h1 style={{ fontSize: 24, marginTop: 16 }}>Partner Admin</h1>
      <p style={{ opacity: 0.7, fontSize: 13, marginTop: 4 }}>
        Manage Khuloh Safe Spots and issue QR codes for partner venues.
      </p>

      <section
        style={{
          marginTop: 16, padding: 12, borderRadius: 12,
          background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)',
        }}
      >
        <label style={{ fontSize: 12, opacity: 0.8 }}>Admin key (kept in this tab only)</label>
        <input
          type="password"
          autoComplete="off"
          value={adminKey}
          onChange={(e) => persistKey(e.target.value)}
          placeholder="KHULOH_ADMIN_KEY"
          style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 6 }}
        />
      </section>

      {error && <p style={{ color: 'tomato', marginTop: 12 }}>{error}</p>}

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 20 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Safe Spots</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={refresh} disabled={loading}>{loading ? '⟳…' : '⟳ Refresh'}</button>
          <button onClick={() => setEditing({})}>+ New spot</button>
        </div>
      </div>

      {editing && (
        <SpotEditor
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={saveSpot}
        />
      )}

      <ul style={{ listStyle: 'none', padding: 0, marginTop: 12 }}>
        {spots.map((s) => (
          <SpotRow
            key={s.id}
            spot={s}
            adminKey={adminKey}
            onEdit={() => setEditing(s)}
          />
        ))}
        {spots.length === 0 && !loading && (
          <li style={{ opacity: 0.6 }}>No spots yet — click “New spot” to add one.</li>
        )}
      </ul>
    </main>
  );
}

function SpotRow({ spot, adminKey, onEdit }: { spot: SafeSpot; adminKey: string; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li
      style={{
        padding: 12, borderRadius: 10, marginBottom: 8,
        background: 'var(--surface, #111)', display: 'grid', gap: 6,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong>{spot.name}</strong>{' '}
          <span style={{ opacity: 0.6, fontSize: 12 }}>{spot.city}</span>
          {!spot.active && <span style={{ marginLeft: 6, fontSize: 11, color: 'tomato' }}>inactive</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onEdit} style={{ fontSize: 12 }}>Edit</button>
          <button onClick={() => setOpen((v) => !v)} style={{ fontSize: 12 }} disabled={!adminKey}>
            {open ? 'Hide QR' : 'Issue QR'}
          </button>
        </div>
      </div>
      {spot.deal_text && <div style={{ fontSize: 13, opacity: 0.8 }}>🎁 {spot.deal_text}</div>}
      {open && <QrPanel spotId={spot.id} spotName={spot.name} adminKey={adminKey} />}
    </li>
  );
}

function SpotEditor({
  initial, onCancel, onSave,
}: {
  initial: Partial<SafeSpot>;
  onCancel: () => void;
  onSave: (s: Partial<SafeSpot>) => void;
}) {
  const [form, setForm] = useState<Partial<SafeSpot>>({
    name: '', city: '', lat: 0, lng: 0, address: '', deal_text: '', active: true,
    ...initial,
  });
  const isNew = !initial.id;

  return (
    <section
      style={{
        marginTop: 12, padding: 12, borderRadius: 10,
        background: 'var(--surface, #111)', border: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>{isNew ? 'New Safe Spot' : `Edit: ${initial.name}`}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
        <Field label="Name"     value={form.name ?? ''}      onChange={(v) => setForm({ ...form, name: v })} />
        <Field label="City"     value={form.city ?? ''}      onChange={(v) => setForm({ ...form, city: v })} />
        <Field label="Latitude" value={String(form.lat ?? '')}  onChange={(v) => setForm({ ...form, lat: Number(v) })} inputMode="decimal" />
        <Field label="Longitude" value={String(form.lng ?? '')} onChange={(v) => setForm({ ...form, lng: Number(v) })} inputMode="decimal" />
        <Field label="Address"   value={form.address ?? ''}   onChange={(v) => setForm({ ...form, address: v })} />
        <Field label="Deal text" value={form.deal_text ?? ''} onChange={(v) => setForm({ ...form, deal_text: v })} />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={form.active ?? true}
          onChange={(e) => setForm({ ...form, active: e.target.checked })}
        />
        Active
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={() => onSave(form)} disabled={!form.name || !form.city}>
          {isNew ? 'Create' : 'Save'}
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

function Field({
  label, value, onChange, inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        style={{ padding: 6, borderRadius: 6 }}
      />
    </label>
  );
}

function QrPanel({ spotId, spotName, adminKey }: { spotId: string; spotName: string; adminKey: string }) {
  const [data, setData] = useState<{ token: string; url: string; exp_sec: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ttl, setTtl] = useState(60); // minutes
  const [issuedAt, setIssuedAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number>(0);
  const [qrSvg, setQrSvg] = useState<string | null>(null);

  async function issue() {
    setError(null);
    try {
      const res = await fetch(
        `${signalingUrl()}/api/khuloh/partner/qr?spotId=${encodeURIComponent(spotId)}&ttlMin=${ttl}`,
        { headers: { 'X-Khuloh-Admin-Key': adminKey } },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `http_${res.status}`);
      setData(body);
      setIssuedAt(Date.now());
      setRemaining(body.exp_sec);
      setQrSvg(await renderQr(body.url));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    if (!issuedAt || !data) return;
    const id = window.setInterval(() => {
      const left = Math.max(0, data.exp_sec - Math.floor((Date.now() - issuedAt) / 1000));
      setRemaining(left);
      if (left === 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [issuedAt, data]);

  return (
    <div
      style={{
        marginTop: 8, padding: 10, borderRadius: 8,
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12 }}>
          TTL (min)
          <input
            type="number" min={1} max={1440} value={ttl}
            onChange={(e) => setTtl(Math.max(1, Number(e.target.value) || 60))}
            style={{ width: 80, marginLeft: 6, padding: 4, borderRadius: 4 }}
          />
        </label>
        <button onClick={issue} style={{ fontSize: 12 }}>Generate QR</button>
        {data && (
          <span style={{ fontSize: 11, opacity: 0.7 }}>
            expires in {Math.floor(remaining / 60)}m {remaining % 60}s
          </span>
        )}
      </div>
      {error && <p style={{ color: 'tomato', fontSize: 12, margin: '6px 0 0' }}>{error}</p>}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 12, marginTop: 10, alignItems: 'start' }}>
          <div
            style={{ background: 'white', padding: 8, borderRadius: 8, width: 180, height: 180 }}
            dangerouslySetInnerHTML={qrSvg ? { __html: qrSvg } : undefined}
          />
          <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
            <div style={{ opacity: 0.7 }}>Display this at {spotName}. Visitors can scan from the app to check in.</div>
            <textarea
              readOnly
              value={data.url}
              style={{ width: '100%', minHeight: 60, fontFamily: 'monospace', fontSize: 11, padding: 6, borderRadius: 4 }}
            />
            <button
              onClick={() => navigator.clipboard?.writeText(data.url).catch(() => {})}
              style={{ width: 'fit-content', fontSize: 12 }}
            >
              Copy URL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Lazy-load the qrcode library from the public esm CDN. The admin console
 * is rarely used so we avoid bundling the dependency. We use an indirect
 * `Function('return import(...)')` to hide the URL from the TypeScript
 * module resolver.
 */
async function renderQr(text: string): Promise<string> {
  const dynImport = new Function('u', 'return import(/* webpackIgnore: true */ u)') as (u: string) => Promise<unknown>;
  const mod = await dynImport('https://esm.sh/qrcode@1.5.4') as {
    default: { toString: (txt: string, opts: object) => Promise<string> };
  };
  return mod.default.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
}
