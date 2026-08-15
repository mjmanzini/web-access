import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { ActivityLog } from '../api/types';

/** Rows are keyed by device when known, else by raw client IP. */
const keyOf = (r: ActivityLog) => r.deviceId ?? r.clientIp;
const labelOf = (r: ActivityLog) => r.deviceName ?? r.clientIp;

export default function Activity() {
  // Recent activity across all devices — drives the per-device chips + counts.
  const [all, setAll] = useState<ActivityLog[]>([]);
  // Rows for the selected device, fetched server-side so a quiet device isn't
  // crowded out of the window by a chatty one.
  const [deviceRows, setDeviceRows] = useState<ActivityLog[]>([]);
  const [filter, setFilter] = useState<'all' | 'blocked'>('all');
  const [params, setParams] = useSearchParams();

  const selected = params.get('device');

  const load = () => {
    api.activity(300).then(setAll).catch(() => {});
    if (selected) {
      // Unknown clients have no device id; those filter client-side instead.
      const isDeviceId = selected.includes('-');
      if (isDeviceId) api.activity(300, selected).then(setDeviceRows).catch(() => {});
    } else {
      setDeviceRows([]);
    }
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  /** One entry per device seen recently, busiest first. */
  const devices = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const r of all) {
      const key = keyOf(r);
      const entry = map.get(key) ?? { key, label: labelOf(r), count: 0 };
      entry.count++;
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [all]);

  const select = (key: string | null) => {
    if (key) setParams({ device: key });
    else setParams({});
  };

  // Selected device: prefer server-filtered rows; fall back to client-side for
  // IP-keyed (unknown) clients that have no device record yet.
  const base = selected
    ? deviceRows.length || selected.includes('-')
      ? deviceRows
      : all.filter((r) => keyOf(r) === selected)
    : all;
  const shown = base.filter((r) => (filter === 'all' ? true : r.action === 'blocked'));
  const blockedCount = base.filter((r) => r.action === 'blocked').length;
  const current = devices.find((d) => d.key === selected);

  return (
    <>
      <div className="header">
        <h1>Activity</h1>
        <div className="row">
          <button className={filter === 'all' ? '' : 'ghost'} onClick={() => setFilter('all')}>All</button>
          <button className={filter === 'blocked' ? 'danger' : 'ghost'} onClick={() => setFilter('blocked')}>Blocked</button>
        </div>
      </div>

      {/* Per-device chips: the "grouping" view — who has been busy, and how much. */}
      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        <button className={selected ? 'ghost' : ''} onClick={() => select(null)}>
          All devices <span className="muted">({all.length})</span>
        </button>
        {devices.map((d) => (
          <button
            key={d.key}
            className={selected === d.key ? '' : 'ghost'}
            onClick={() => select(d.key)}
            title={d.label}
          >
            {d.label} <span className="muted">({d.count})</span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>{current?.label ?? 'Device'}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {base.length} recent {base.length === 1 ? 'query' : 'queries'} · {blockedCount} blocked
              </div>
            </div>
            <button className="ghost" onClick={() => select(null)}>Clear filter</button>
          </div>
        </div>
      )}

      <div className="card">
        <table>
          <thead>
            <tr><th>Time</th><th>Device</th><th>Domain</th><th>Result</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="muted">{new Date(r.timestamp).toLocaleTimeString()}</td>
                <td>
                  {r.deviceName ?? r.clientIp}
                  {r.deviceName && (
                    <div className="muted" style={{ fontSize: 11 }}>{r.clientIp}</div>
                  )}
                </td>
                <td>{r.domain}</td>
                <td>
                  <span className={`badge ${r.action === 'blocked' ? 'danger' : r.action === 'rewritten' ? 'warn' : 'ok'}`}>
                    {r.action}
                  </span>
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={4} className="muted">No activity yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
