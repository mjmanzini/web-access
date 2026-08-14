import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ActivityLog } from '../api/types';

export default function Activity() {
  const [rows, setRows] = useState<ActivityLog[]>([]);
  const [filter, setFilter] = useState<'all' | 'blocked'>('all');

  const load = () => api.activity(300).then(setRows).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  const shown = rows.filter((r) => (filter === 'all' ? true : r.action === 'blocked'));

  return (
    <>
      <div className="header">
        <h1>Activity</h1>
        <div className="row">
          <button className={filter === 'all' ? '' : 'ghost'} onClick={() => setFilter('all')}>All</button>
          <button className={filter === 'blocked' ? 'danger' : 'ghost'} onClick={() => setFilter('blocked')}>Blocked</button>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th>Time</th><th>Client</th><th>Domain</th><th>Result</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="muted">{new Date(r.timestamp).toLocaleTimeString()}</td>
                <td>{r.clientIp}</td>
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
