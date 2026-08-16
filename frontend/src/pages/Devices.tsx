import { Fragment, useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { BandwidthRow, Device, DnsSetup, Profile } from '../api/types';
import { formatBytes, formatRate } from '../api/format';

/** A name still derived from discovery rather than chosen by the parent. */
const isAutoName = (d: Device) =>
  d.name === d.ipAddress || /^\d+\.\d+\.\d+\.\d+$/.test(d.name);

/** "3m ago" / "2h ago" / "4d ago" — compact last-seen for offline devices. */
function lastSeen(at: string | null): string {
  if (!at) return 'never seen';
  const mins = Math.floor((Date.now() - new Date(at).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function Devices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [bandwidth, setBandwidth] = useState<Record<string, BandwidthRow>>({});
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<{ id: string; data: DnsSetup } | null>(null);
  const [pair, setPair] = useState<
    { id: string; name: string; url: string; expiresInMinutes: number } | null
  >(null);
  const [pairError, setPairError] = useState<string | null>(null);
  // Inline rename: which row is being edited, and its pending text.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [showOffline, setShowOffline] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = () => {
    api.devices().then(setDevices).catch(() => {});
    api.profiles().then(setProfiles).catch(() => {});
    api.bandwidth()
      .then((rows) => setBandwidth(Object.fromEntries(rows.map((r) => [r.deviceId, r]))))
      .catch(() => {});
  };
  useEffect(() => {
    load();
    const t = setInterval(() => api.bandwidth()
      .then((rows) => setBandwidth(Object.fromEntries(rows.map((r) => [r.deviceId, r]))))
      .catch(() => {}), 15_000);
    return () => clearInterval(t);
  }, []);

  const sync = async () => {
    setBusy(true);
    try {
      await api.syncDevices();
      load();
    } finally {
      setBusy(false);
    }
  };

  const assign = async (id: string, profileId: string) => {
    await api.updateDevice(id, { profileId: profileId || null });
    load();
  };
  /**
   * Pause/resume with visible state. Without this the button looked inert on a
   * phone: the request is fired, nothing changes until the next poll, and a
   * failure (expired session, API unreachable) is swallowed entirely — so a tap
   * that never reached the backend is indistinguishable from one that worked.
   */
  const toggleBlock = async (d: Device) => {
    setPending((prev) => new Set(prev).add(d.id));
    setError('');
    try {
      const updated = await api.updateDevice(d.id, { blocked: !d.blocked });
      // Reflect the server's answer immediately rather than waiting for a poll.
      setDevices((prev) => prev.map((x) => (x.id === d.id ? { ...x, blocked: updated.blocked } : x)));
      load();
    } catch (e) {
      setError(
        `Could not ${d.blocked ? 'resume' : 'pause'} ${d.name}: ${
          e instanceof Error ? e.message : 'request failed'
        }`,
      );
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(d.id);
        return next;
      });
    }
  };
  const startRename = (d: Device) => {
    setEditing(d.id);
    setDraft(d.name);
  };
  const saveRename = async (id: string) => {
    const name = draft.trim();
    setEditing(null);
    // A device's name is set by the parent; a scan never overwrites it.
    if (name && name !== devices.find((d) => d.id === id)?.name) {
      await api.updateDevice(id, { name });
      load();
    }
  };
  const forget = async (d: Device) => {
    if (!confirm(`Remove "${d.name}" from the device list?\n\nIt will reappear if it is still on the network.`)) return;
    await api.deleteDevice(d.id);
    load();
  };
  /** Mint a fresh pairing link for this device and reveal it. */
  const showPair = async (d: Device) => {
    if (pair?.id === d.id) return setPair(null);
    setPairError(null);
    try {
      const out = await api.pairLink(d.id);
      setPair({ id: d.id, name: d.name, ...out });
    } catch (e) {
      setPair(null);
      setPairError(`Could not create a pairing link for ${d.name}: ${(e as Error).message}`);
    }
  };

  const showSetup = async (id: string) => {
    if (setup?.id === id) return setSetup(null);
    const data = await api.dnsSetup(id);
    setSetup({ id, data });
  };

  /** Why this device's profile has it offline, if it does. */
  const profilePause = (d: Device): string | null => {
    const p = profiles.find((x) => x.id === d.profileId);
    if (!p?.internetPaused) return null;
    return p.pausedReason === 'bedtime'
      ? 'bedtime'
      : p.pausedReason === 'quota_exceeded'
        ? 'daily limit'
        : 'profile paused';
  };

  /** Lift a profile-level pause — the action that actually restores internet. */
  const resumeProfile = async (d: Device) => {
    const p = profiles.find((x) => x.id === d.profileId);
    if (!p) return;
    setPending((prev) => new Set(prev).add(d.id));
    setError('');
    try {
      await api.pauseProfile(p.id, false);
      load();
    } catch (e) {
      setError(`Could not resume ${p.name}: ${e instanceof Error ? e.message : 'request failed'}`);
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(d.id);
        return next;
      });
    }
  };

  // Online first, then devices the parent has organised (named / assigned to a
  // profile), then the rest — so the list reads top-down by relevance.
  const rank = (d: Device) =>
    (d.isOnline ? 0 : 100) + (d.profileId ? 0 : 10) + (isAutoName(d) ? 5 : 0);
  const sorted = [...devices].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
  );
  const online = sorted.filter((d) => d.isOnline);
  const offline = sorted.filter((d) => !d.isOnline);
  const shown = showOffline ? sorted : online;

  return (
    <>
      <div className="header">
        <h1>Devices</h1>
        <div className="row">
          <span className="badge ok">{online.length} online</span>
          {offline.length > 0 && (
            <button className="ghost" onClick={() => setShowOffline((v) => !v)}>
              {showOffline ? 'Hide' : 'Show'} {offline.length} offline
            </button>
          )}
          <button onClick={sync} disabled={busy}>{busy ? 'Scanning…' : 'Scan network'}</button>
        </div>
      </div>

      {error && <div className="badge danger" style={{ marginBottom: 12, display: "block" }}>{error}</div>}
      {pairError && <div className="badge danger" style={{ marginBottom: 12, display: "block" }}>{pairError}</div>}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Device</th><th>Identity</th><th>Today ↓/↑</th><th>Profile</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((d) => (
              <Fragment key={d.id}>
                <tr style={d.isOnline ? undefined : { opacity: 0.55 }}>
                  <td>
                    {editing === d.id ? (
                      <div className="row">
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveRename(d.id);
                            if (e.key === 'Escape') setEditing(null);
                          }}
                          onBlur={() => saveRename(d.id)}
                          style={{ width: 170 }}
                          placeholder="e.g. Jastice's phone"
                        />
                      </div>
                    ) : (
                      <>
                        <span
                          onClick={() => startRename(d)}
                          title="Click to rename"
                          style={{ cursor: 'pointer' }}
                        >
                          <span className={`dot ${d.isOnline ? 'on' : 'off'}`} /> {d.name}
                        </span>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {d.ipAddress}
                          {d.vendor && ` · ${d.vendor}`}
                        </div>
                        {/* Deliberately in the FIRST column. The other actions
                            sit in the last one, and on a phone this table
                            scrolls sideways — anything over there is
                            effectively invisible, which is exactly how this
                            action got reported as "not on the dashboard". */}
                        <button
                          className="linkish"
                          onClick={() => showPair(d)}
                          title="Set up the kid app on this device"
                        >
                          {pair?.id === d.id ? 'Hide pairing' : '📱 Pair kid app'}
                        </button>
                      </>
                    )}
                  </td>
                  <td>
                    {/* Stable identity = ClientID present and MAC not randomized. */}
                    {d.macRandomized && !d.clientId ? (
                      <span className="badge warn" title="Randomized MAC and no ClientID — controls may drift">IP-only</span>
                    ) : (
                      <span className="badge ok" title={d.clientId ?? ''}>stable</span>
                    )}{' '}
                    {d.macRandomized && <span className="badge warn">rnd MAC</span>}
                  </td>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                    {bandwidth[d.id]
                      ? <>
                          {formatBytes(bandwidth[d.id].rxBytesToday)} / {formatBytes(bandwidth[d.id].txBytesToday)}
                          {(bandwidth[d.id].rxRateBps + bandwidth[d.id].txRateBps > 0) && (
                            <div style={{ fontSize: 11 }}>{formatRate(bandwidth[d.id].rxRateBps)} ↓</div>
                          )}
                        </>
                      : '—'}
                  </td>
                  <td>
                    <select value={d.profileId ?? ''} onChange={(e) => assign(d.id, e.target.value)}>
                      <option value="">Unassigned</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {d.isOnline
                      ? <span className="badge ok">online</span>
                      : <span className="badge muted" title={d.lastSeenAt ?? ''}>offline</span>}
                    {/* A device can be cut off by its PROFILE rather than by
                        itself. Without saying so, the device-level Resume
                        button looks broken: it toggles a flag that isn't the
                        thing blocking. */}
                    {profilePause(d) && (
                      <div style={{ marginTop: 4 }}>
                        <span className="badge danger" title="Paused by this device's profile">
                          {profilePause(d)}
                        </span>
                      </div>
                    )}
                    {/* The state that makes everything else a lie: online, rules
                        applied, and resolving somewhere we can't see. */}
                    {d.isOnline && d.usingFilter === false && (
                      <div style={{ marginTop: 4 }}>
                        <span
                          className="badge warn"
                          title={
                            'This device is connected but has not asked Home Guardian to resolve ' +
                            'anything recently, so filtering and bedtime are NOT reaching it. ' +
                            'Usual causes: it still holds an old DHCP lease (toggle its Wi-Fi), ' +
                            'or Private DNS / DoT is switched on in its settings.'
                          }
                        >
                          ⚠ not filtered
                        </span>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {d.lastFilteredAt
                            ? `last seen by filter ${lastSeen(d.lastFilteredAt)}`
                            : 'never seen by filter'}
                        </div>
                      </div>
                    )}
                    {!d.isOnline && (
                      <div className="muted" style={{ fontSize: 11 }}>{lastSeen(d.lastSeenAt)}</div>
                    )}
                    {d.blocked && <div><span className="badge danger">blocked</span></div>}
                  </td>
                  <td className="row" style={{ justifyContent: 'flex-end' }}>
                    <button className="ghost" onClick={() => navigate(`/activity?device=${d.id}`)}>
                      Activity
                    </button>
                    <button className="ghost" onClick={() => startRename(d)}>Rename</button>
                    <button className="ghost" onClick={() => showSetup(d.id)}>DNS setup</button>
                    {/* Also offered under the device name. Duplicated on
                        purpose: this column is where a parent actually
                        operates, and on a phone the two are never on screen
                        together — the table scrolls sideways between them. */}
                    <button className="ghost" onClick={() => showPair(d)}>
                      {pair?.id === d.id ? 'Hide pairing' : '📱 Pair kid app'}
                    </button>
                    <button className="ghost" onClick={() => forget(d)} title="Remove this entry">Forget</button>
                    {/* When the profile is what's blocking, offer the action
                        that actually works. */}
                    {profilePause(d) && (
                      <button disabled={pending.has(d.id)} onClick={() => resumeProfile(d)}>
                        {pending.has(d.id) ? '…' : `Resume ${profilePause(d)}`}
                      </button>
                    )}
                    <button
                      className={d.blocked ? '' : 'danger'}
                      disabled={pending.has(d.id)}
                      onClick={() => toggleBlock(d)}
                      title={
                        d.blocked
                          ? 'Give this device internet again'
                          : 'Cut this device off now — dinner, homework, bedtime'
                      }
                    >
                      {pending.has(d.id) ? '…' : d.blocked ? 'Resume internet' : 'Pause internet'}
                    </button>
                  </td>
                </tr>
                {pair?.id === d.id && (
                  <tr>
                    <td colSpan={6} style={{ background: 'var(--panel-2)' }}>
                      <PairPanel pair={pair} />
                    </td>
                  </tr>
                )}
                {setup?.id === d.id && (
                  <tr>
                    <td colSpan={6} style={{ background: 'var(--panel-2)' }}>
                      <SetupPanel data={setup.data} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!devices.length && (
              <tr><td colSpan={6} className="muted">No devices yet — run a network scan.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Per-device encrypted-DNS setup so its ClientID travels with every query. */
function SetupPanel({ data }: { data: DnsSetup }) {
  return (
    <div className="grid" style={{ gap: 6, padding: '4px 0' }}>
      <div className="muted" style={{ fontSize: 12 }}>
        ClientID <code>{data.clientId}</code> — set one of these as the device's
        private DNS so its controls follow it across networks & IP changes.
      </div>
      {data.domainConfigured ? (
        <>
          <Field label="DoT (Android Private DNS)" value={data.dot!} />
          <Field label="DoH (browsers / Apple config)" value={data.doh!} />
          <Field label="DoQ" value={data.doq!} />
        </>
      ) : (
        <div className="badge warn">
          Set ADGUARD_DNS_DOMAIN to your AdGuard server's public hostname to
          enable DoT/DoH endpoints. Until then, identity falls back to MAC/IP.
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="row">
      <span className="muted" style={{ fontSize: 12, width: 210 }}>{label}</span>
      <code style={{ userSelect: 'all' }}>{value}</code>
    </div>
  );
}

/**
 * Everything needed to get the kid app onto a child's device, from a parent's
 * phone. The link is one-time and short-lived, so it is minted on demand rather
 * than shown by default.
 *
 * The QR code carries the whole handoff: the parent is holding their phone, the
 * link has to end up in a browser on a different device, and reading a signed
 * token aloud is not a thing anyone will do twice.
 */
function PairPanel({
  pair,
}: {
  pair: { id: string; name: string; url: string; expiresInMinutes: number };
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pair.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked on insecure origins and in some mobile browsers.
      // The URL is on screen and selectable, so this is a nicety, not the path.
      setCopied(false);
    }
  };

  return (
    <div className="grid pair-panel" style={{ gap: 10, padding: '6px 0' }}>
      {/* The name goes first and goes big. A parent generates this from one row
          and scans it on a different device, so the two can drift apart — that
          happened once and a tablet was paired as the laptop, with nothing on
          screen to catch it. */}
      <div className="muted" style={{ fontSize: 12 }}>You are pairing</div>
      <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
        {pair.name}
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        Scan this on <strong>{pair.name}</strong> itself — the device will ask you
        to confirm that name before anything is saved.
      </div>
      <ol className="muted" style={{ fontSize: 12, margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
        <li>On {pair.name}, open Chrome and scan this code (or paste the link).</li>
        <li>Confirm the name it shows is <em>{pair.name}</em>, then tap yes.</li>
        <li>Chrome menu ⋮ → <strong>Add to Home screen</strong> → Install.</li>
        <li>Open the app → <strong>Tell me before bedtime</strong> → allow notifications.</li>
      </ol>

      <QrCode value={pair.url} />

      <div className="row" style={{ gap: 8 }}>
        <code
          style={{
            flex: '1 1 200px',
            minWidth: 0,
            overflowWrap: 'anywhere',
            userSelect: 'all',
            fontSize: 11,
          }}
        >
          {pair.url}
        </code>
        <button className="ghost" onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      <div className="muted" style={{ fontSize: 11 }}>
        Expires in {pair.expiresInMinutes} minutes. Pair while the device still has
        internet — afterwards the app keeps working even when it is blocked.
      </div>
    </div>
  );
}

/**
 * QR rendered as inline SVG rects — no canvas, no network, no image host, so it
 * works on a phone behind Access and survives being printed or screenshotted.
 */
function QrCode({ value }: { value: string }) {
  const qr = qrcode(0, 'L'); // auto-size, low ECC: plenty for a short-lived URL
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 2;
  const size = count + quiet * 2;

  const rects: JSX.Element[] = [];
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        rects.push(<rect key={`${r}-${c}`} x={c + quiet} y={r + quiet} width={1} height={1} />);
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Pairing QR code"
      style={{
        width: 'min(230px, 60vw)',
        height: 'auto',
        background: '#fff',
        borderRadius: 8,
        padding: 6,
      }}
      shapeRendering="crispEdges"
    >
      <g fill="#000">{rects}</g>
    </svg>
  );
}
