import { useMemo, useState } from 'react';
import { useAlerts } from '../api/useAlerts';
import type { Alert } from '../api/types';

/** Alerts have no server id; this is stable enough to dismiss one. */
const keyOf = (a: Alert) => `${a.at}|${a.type}|${a.message}`;

const LABEL: Partial<Record<Alert['type'], string>> = {
  bypass_attempt: 'DNS bypass',
  mac_randomized: 'Random MAC',
  device_new: 'New device',
  quota_exceeded: 'Daily limit',
  bedtime_pause: 'Bedtime',
  system_down: 'Offline',
  system_recovered: 'Back online',
};

/**
 * Live alert tray.
 *
 * Collapsed to a single bar by default: on a phone the Devices table is the
 * thing being used, and an expanded tray sits on top of it. Tapping the bar
 * opens it; it closes again after dismissing everything.
 *
 * Dismissal has to cope with a stream. Hiding one alert by key is not enough if
 * new ones keep arriving — "Clear" therefore also mutes everything raised up to
 * that moment, so the tray actually empties instead of instantly refilling.
 */
export default function AlertsFeed() {
  const { alerts, connected } = useAlerts();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [mutedBefore, setMutedBefore] = useState(0);
  const [open, setOpen] = useState(false);

  const visible = useMemo(
    () =>
      alerts
        .filter((a) => !dismissed.has(keyOf(a)))
        .filter((a) => new Date(a.at).getTime() > mutedBefore)
        .slice(0, 8),
    [alerts, dismissed, mutedBefore],
  );

  if (!visible.length) return null;

  const dismiss = (a: Alert) => {
    const next = new Set(dismissed);
    next.add(keyOf(a));
    setDismissed(next);
    // Closing the last one collapses the tray rather than leaving an empty box.
    if (visible.length === 1) setOpen(false);
  };

  const clearAll = () => {
    setMutedBefore(Date.now());
    setDismissed(new Set());
    setOpen(false);
  };

  const worst = visible.some((a) => a.severity === 'critical')
    ? 'critical'
    : visible.some((a) => a.severity === 'warning')
      ? 'warning'
      : 'info';

  return (
    <div className={`alerts ${open ? 'open' : ''}`} role="region" aria-label="Live alerts">
      <div className="alerts-bar">
        <button
          className={`alerts-toggle ${worst}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className={`dot ${connected ? 'on' : 'off'}`} />
          {visible.length} alert{visible.length === 1 ? '' : 's'}
          <span className="alerts-chevron">{open ? '▾' : '▴'}</span>
        </button>
        {open && (
          <button className="alerts-clear" onClick={clearAll}>
            Clear all
          </button>
        )}
      </div>

      {open && (
        <div className="alerts-list">
          {visible.map((a) => (
            <div key={keyOf(a)} className={`alert ${a.severity}`}>
              <div className="alert-body">
                <strong>{LABEL[a.type] ?? a.type.replace(/_/g, ' ')}</strong>
                <div>{a.message}</div>
              </div>
              <button
                className="alert-dismiss"
                onClick={() => dismiss(a)}
                aria-label="Dismiss"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
