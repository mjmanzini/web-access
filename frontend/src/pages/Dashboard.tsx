import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ActivityLog, Device, Profile } from '../api/types';

export default function Dashboard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [net, setNet] = useState<{ running: boolean; version: string | null }>();

  useEffect(() => {
    api.devices().then(setDevices).catch(() => {});
    api.profiles().then(setProfiles).catch(() => {});
    api.activity(200).then(setActivity).catch(() => {});
    api.networkStatus().then(setNet).catch(() => setNet({ running: false, version: null }));
  }, []);

  const online = devices.filter((d) => d.isOnline).length;
  const randomized = devices.filter((d) => d.macRandomized).length;
  const blockedToday = activity.filter((a) => a.action === 'blocked').length;
  const pausedProfiles = profiles.filter((p) => p.internetPaused).length;

  return (
    <>
      <div className="header">
        <h1>Dashboard</h1>
        <span className={`badge ${net?.running ? 'ok' : 'danger'}`}>
          AdGuard {net?.running ? `up · ${net.version ?? ''}` : 'unreachable'}
        </span>
      </div>

      <div className="grid cards">
        <Stat label="Devices online" value={`${online}/${devices.length}`} />
        <Stat label="Profiles" value={`${profiles.length}`} sub={`${pausedProfiles} paused`} />
        <Stat label="Blocked (recent)" value={`${blockedToday}`} />
        <Stat
          label="Randomized MACs"
          value={`${randomized}`}
          sub={randomized ? 'possible evasion' : 'none'}
          danger={randomized > 0}
        />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Recent blocks</h2>
        <table>
          <thead>
            <tr><th>Time</th><th>Client</th><th>Domain</th></tr>
          </thead>
          <tbody>
            {activity.filter((a) => a.action === 'blocked').slice(0, 8).map((a) => (
              <tr key={a.id}>
                <td className="muted">{new Date(a.timestamp).toLocaleTimeString()}</td>
                <td>{a.clientIp}</td>
                <td>{a.domain}</td>
              </tr>
            ))}
            {!activity.some((a) => a.action === 'blocked') && (
              <tr><td colSpan={3} className="muted">No blocks recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat(props: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="card">
      <div className="muted">{props.label}</div>
      <div className={`stat ${props.danger ? '' : ''}`}>{props.value}</div>
      {props.sub && <div className="muted" style={{ fontSize: 12 }}>{props.sub}</div>}
    </div>
  );
}
