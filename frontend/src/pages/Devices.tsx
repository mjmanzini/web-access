import { Fragment, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { BandwidthRow, Device, DnsSetup, Profile } from '../api/types';
import { formatBytes, formatRate } from '../api/format';

export default function Devices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [bandwidth, setBandwidth] = useState<Record<string, BandwidthRow>>({});
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<{ id: string; data: DnsSetup } | null>(null);

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
  const showSetup = async (id: string) => {
    if (setup?.id === id) return setSetup(null);
    const data = await api.dnsSetup(id);
    setSetup({ id, data });
  };

  return (
    <>
      <div className="header">
        <h1>Devices</h1>
        <button onClick={sync} disabled={busy}>{busy ? 'Scanning…' : 'Scan network'}</button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Device</th><th>IP</th><th>Identity</th><th>Today ↓/↑</th><th>Profile</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <Fragment key={d.id}>
                <tr>
                  <td>
                    <span className={`dot ${d.isOnline ? 'on' : 'off'}`} /> {d.name}
                  </td>
                  <td className="muted">{d.ipAddress}</td>
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
                  <td>
                    {d.blocked
                      ? <span className="badge danger">blocked</span>
                      : <span className="badge ok">allowed</span>}
                  </td>
                  <td className="row" style={{ justifyContent: 'flex-end' }}>
                    <button className="ghost" onClick={() => showSetup(d.id)}>DNS setup</button>
                    <button className={d.blocked ? 'ghost' : 'danger'} onClick={() => toggleBlock(d)}>
                      {d.blocked ? 'Unblock' : 'Block'}
                    </button>
                  </td>
                </tr>
                {setup?.id === d.id && (
                  <tr>
                    <td colSpan={7} style={{ background: 'var(--panel-2)' }}>
                      <SetupPanel data={setup.data} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!devices.length && (
              <tr><td colSpan={7} className="muted">No devices yet — run a network scan.</td></tr>
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
