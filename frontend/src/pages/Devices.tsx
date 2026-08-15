import { Fragment, useEffect, useState } from 'react';
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
  // Inline rename: which row is being edited, and its pending text.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [showOffline, setShowOffline] = useState(false);
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
  const toggleBlock = async (d: Device) => {
    await api.updateDevice(d.id, { blocked: !d.blocked });
    load();
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
  const showSetup = async (id: string) => {
    if (setup?.id === id) return setSetup(null);
    const data = await api.dnsSetup(id);
    setSetup({ id, data });
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
                    <button className="ghost" onClick={() => forget(d)} title="Remove this entry">Forget</button>
                    <button
                      className={d.blocked ? '' : 'danger'}
                      onClick={() => toggleBlock(d)}
                      title={
                        d.blocked
                          ? 'Give this device internet again'
                          : 'Cut this device off now — dinner, homework, bedtime'
                      }
                    >
                      {d.blocked ? 'Resume internet' : 'Pause internet'}
                    </button>
                  </td>
                </tr>
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
