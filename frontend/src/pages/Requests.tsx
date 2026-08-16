import { api } from '../api/client';
import type { AccessRequest } from '../api/types';
import {
  Async,
  ErrorNotice,
  Skeleton,
  useAction,
  useAsync,
  useConfirm,
} from '../components/ui';

/** Parent's queue of "please unblock X" requests raised from devices. */
export default function Requests() {
  const state = useAsync<AccessRequest[]>(() => api.pendingRequests(), []);
  const action = useAction();
  const confirm = useConfirm();

  // Approving unblocks a site for a child, and the child is told; that is worth
  // a beat of thought. Denying just leaves things as they are, so it is not.
  const approve = (r: AccessRequest) =>
    action.run(`approve:${r.id}`, async () => {
      const ok = await confirm({
        title: `Allow ${r.domain}?`,
        body: `This unblocks ${r.domain} for the device that asked (${r.clientIp}). You can block it again from Rules.`,
        confirmLabel: 'Allow it',
      });
      if (!ok) return;
      await api.approveRequest(r.id);
      state.reload();
    });

  const deny = (r: AccessRequest) =>
    action.run(`deny:${r.id}`, async () => {
      await api.denyRequest(r.id);
      state.reload();
    });

  return (
    <>
      <div className="header">
        <h1>Requests</h1>
        <button className="ghost" onClick={state.reload} disabled={state.loading}>
          {state.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {action.error && (
        <ErrorNotice message={action.error} onDismiss={action.clearError} />
      )}

      <div className="card">
        <Async
          state={state}
          skeleton={<Skeleton rows={3} height={22} />}
          empty={{
            icon: '📭',
            title: 'No pending requests',
            hint: 'When a child asks for a site, it appears here.',
          }}
        >
          {(requests) => (
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
                      <button
                        onClick={() => approve(r)}
                        disabled={action.busy(`approve:${r.id}`)}
                      >
                        {action.busy(`approve:${r.id}`) ? 'Allowing…' : 'Approve'}
                      </button>
                      <button
                        className="ghost"
                        onClick={() => deny(r)}
                        disabled={action.busy(`deny:${r.id}`)}
                      >
                        {action.busy(`deny:${r.id}`) ? 'Denying…' : 'Deny'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Async>
      </div>
    </>
  );
}
