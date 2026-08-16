import { api } from '../api/client';
import type { StorageInfo } from '../api/types';
import { Async, Skeleton, useAsync } from './ui';

const mb = (bytes: number) => bytes / 1024 / 1024;

const size = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : `${mb(bytes).toFixed(1)} MB`;

/**
 * Where the disk is going.
 *
 * Retention is invisible by nature: it works by things quietly not being there.
 * That makes "are we going to run out of space?" a nagging question with no
 * answer on any screen — so this is the answer, measured rather than promised.
 * The number that matters is the steady state: because old rows are pruned
 * nightly, the database stops growing once it holds one full window, and that
 * ceiling is computable from the current rate.
 */
export default function Storage() {
  const state = useAsync<StorageInfo>(() => api.storageInfo(), []);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Storage</h2>
      <Async state={state} skeleton={<Skeleton rows={3} height={18} />}>
        {(s) => {
          // Once a full window of rows is held, pruning balances ingestion —
          // the raw table stops growing. Everything else is rounding error.
          const settled = s.steadyStateBytes > 0 && s.databaseBytes >= s.steadyStateBytes * 0.9;
          const perYear = mb(s.bytesPerDay) * 365;

          return (
            <>
              <div className="cards" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <div>
                  <div className="stat" style={{ fontSize: 20 }}>{size(s.databaseBytes)}</div>
                  <div className="muted" style={{ fontSize: 11 }}>database now</div>
                </div>
                <div>
                  <div className="stat" style={{ fontSize: 20 }}>{size(s.steadyStateBytes)}</div>
                  <div className="muted" style={{ fontSize: 11 }}>settles at</div>
                </div>
                <div>
                  <div className="stat" style={{ fontSize: 20 }}>
                    {s.rowsPerDay.toLocaleString()}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>queries/day</div>
                </div>
              </div>

              <div className="muted" style={{ fontSize: 12, marginTop: 12, lineHeight: 1.6 }}>
                Keeping <strong>{s.retention.rawDays} days</strong> of individual queries
                ({s.rawRows.toLocaleString()} rows), daily summaries for{' '}
                <strong>{Math.round(s.retention.rollupDays / 30)} months</strong>{' '}
                ({s.rollupRows.toLocaleString()} rows), and settled requests for{' '}
                {s.retention.eventDays} days.
                {s.rawOldest && (
                  <> Oldest query kept: {new Date(s.rawOldest).toLocaleDateString()}.</>
                )}
              </div>

              <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
                {settled ? (
                  <>
                    Growth has levelled off: old rows are pruned as fast as new ones
                    arrive, so this stays around {size(s.steadyStateBytes)} indefinitely.
                  </>
                ) : (
                  <>
                    Still filling its first {s.retention.rawDays}-day window — it will
                    level off near {size(s.steadyStateBytes)} and stop growing, rather
                    than climbing at {perYear.toFixed(0)} MB/year forever.
                  </>
                )}
              </div>

              <details style={{ marginTop: 10 }}>
                <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>
                  Per table
                </summary>
                <div className="grid" style={{ gap: 4, marginTop: 8 }}>
                  {s.tables.map((t) => (
                    <div key={t.name} className="row" style={{ justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12 }}>{t.name}</span>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {t.rows.toLocaleString()} rows · {size(t.bytes)}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            </>
          );
        }}
      </Async>
    </div>
  );
}
