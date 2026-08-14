import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AccessRequest } from '../api/types';

/** Parent's queue of "please unblock X" requests raised from devices. */
export default function Requests() {
  const [requests, setRequests] = useState<AccessRequest[]>([]);

  const load = () => {
    api.pendingRequests().then(setRequests).catch(() => {});
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  const approve = async (id: string) => {
    await api.approveRequest(id);
    load();
  };
  const deny = async (id: string) => {
    await api.denyRequest(id);
    load();
  };

  return (
    <>
      <div className="header"><h1>Requests</h1></div>
      <div className="card">
        <table>
          <thead>
            <tr><th>When</th><th>From</th><th>Domain</th><th>Note</th><th></th></tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td className="muted">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="muted">{r.clientIp}</td>
                <td>{r.domain}</td>
                <td className="muted">{r.note ?? '—'}</td>
                <td className="row" style={{ justifyContent: 'flex-end' }}>
                  <button onClick={() => approve(r.id)}>Approve</button>
                  <button className="ghost" onClick={() => deny(r.id)}>Deny</button>
                </td>
              </tr>
            ))}
            {!requests.length && (
              <tr><td colSpan={5} className="muted">No pending requests.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
