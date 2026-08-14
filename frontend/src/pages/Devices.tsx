import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Device, Profile } from '../api/types';

export default function Devices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.devices().then(setDevices).catch(() => {});
    api.profiles().then(setProfiles).catch(() => {});
  };
  useEffect(load, []);

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
              <th>Device</th><th>IP</th><th>MAC</th><th>Profile</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td>
                  <span className={`dot ${d.isOnline ? 'on' : 'off'}`} /> {d.name}
                </td>
                <td className="muted">{d.ipAddress}</td>
                <td className="muted">
                  {d.macAddress ?? '—'}{' '}
                  {d.macRandomized && <span className="badge warn">randomized</span>}
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
                <td>
                  <button className={d.blocked ? 'ghost' : 'danger'} onClick={() => toggleBlock(d)}>
                    {d.blocked ? 'Unblock' : 'Block'}
                  </button>
                </td>
              </tr>
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
