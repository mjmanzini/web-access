import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Device, HistoryResult } from '../api/types';
import { Async, EmptyState, Skeleton, useAsync } from '../components/ui';

const GRANULARITIES = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
] as const;

const hhmm = (minutes: number) =>
  minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;

/**
 * Audit history: what each device did, period by period.
 *
 * Filters live in the URL so a view can be bookmarked or sent to the other
 * parent, exactly as the Activity page works — "Njabulo, monthly" should be a
 * link, not a sequence of taps to repeat.
 *
 * The two data sources are deliberately visible. Inside the raw retention
 * window every number is exact; beyond it only nightly summaries survive, so
 * those periods are marked. A month from before the system existed says so
 * rather than drawing a confident zero.
 */
export default function History() {
  const [params, setParams] = useSearchParams();
  const granularity = (params.get('granularity') ?? 'daily') as 'daily' | 'weekly' | 'monthly';
  const deviceId = params.get('deviceId') ?? '';

  const devices = useAsync<Device[]>(() => api.devices(), []);
  const history = useAsync<HistoryResult>(
    () => api.history(granularity, deviceId || undefined),
    [granularity, deviceId],
  );

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <div className="header">
        <h1>History</h1>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 8 }}>
          {/* Segmented control: three taps beats a dropdown on a phone. */}
          <div className="row" style={{ gap: 4 }}>
            {GRANULARITIES.map((g) => (
              <button
                key={g.key}
                className={granularity === g.key ? '' : 'ghost'}
                style={{ padding: '8px 14px' }}
                onClick={() => set('granularity', g.key)}
              >
                {g.label}
              </button>
            ))}
          </div>

          <select
            value={deviceId}
            onChange={(e) => set('deviceId', e.target.value)}
            style={{ flex: '1 1 160px', minWidth: 0 }}
          >
            <option value="">All devices</option>
            {(devices.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Async state={history} skeleton={<Skeleton rows={5} height={44} />}>
        {(h) => {
          const shown = h.periods;
          const busiest = Math.max(1, ...shown.map((p) => p.lookups));
          const anyData = shown.some((p) => p.lookups > 0);

          if (!anyData) {
            return (
              <EmptyState
                icon="📅"
                title="Nothing recorded for this period yet"
                hint={
                  granularity === 'monthly'
                    ? 'Monthly history builds up as the weeks pass.'
                    : 'Try a different device, or a wider period.'
                }
              />
            );
          }

          return (
            <>
              {shown.map((p) => (
                <div key={p.start} className="card" style={{ marginBottom: 10 }}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <strong style={{ fontSize: 14 }}>{p.label}</strong>
                    <span style={{ fontSize: 14, whiteSpace: 'nowrap' }}>
                      {p.activeMinutes !== null ? (
                        <strong>{hhmm(p.activeMinutes)}</strong>
                      ) : (
                        <span className="muted">—</span>
                      )}{' '}
                      <span className="muted">online</span>
                    </span>
                  </div>

                  {/* Relative bar: the comparison between periods is the point. */}
                  <div
                    style={{
                      height: 8,
                      background: 'var(--panel-2)',
                      borderRadius: 4,
                      margin: '8px 0 6px',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.round((p.lookups / busiest) * 100)}%`,
                        height: '100%',
                        background: 'var(--accent)',
                        borderRadius: 4,
                        minWidth: p.lookups ? 3 : 0,
                      }}
                    />
                  </div>

                  <div className="muted" style={{ fontSize: 12 }}>
                    {p.lookups.toLocaleString()} requests
                    {p.blocked > 0 && ` · ${p.blocked.toLocaleString()} blocked`}
                    {p.source === 'summary' && ' · from daily summary'}
                    {p.source === 'none' && ' · nothing recorded'}
                  </div>

                  {p.topDomains.length > 0 && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 6, overflowWrap: 'anywhere' }}>
                      Top: {p.topDomains.map((d) => `${d.domain} (${d.hits})`).join(' · ')}
                    </div>
                  )}
                </div>
              ))}

              <div className="muted" style={{ fontSize: 11, lineHeight: 1.6, marginTop: 4 }}>
                Exact per-request detail is kept for {h.rawWindowDays} days. Older periods
                are drawn from nightly summaries — the totals and top sites remain, the
                individual lookups do not.
              </div>
            </>
          );
        }}
      </Async>
    </>
  );
}
