import { useMemo, useState } from 'react';
import { useAlerts } from '../api/useAlerts';
import type { Alert } from '../api/types';

/** Alerts have no server id; this is stable enough to dismiss one. */
const keyOf = (a: Alert) => `${a.at}|${a.type}|${a.message}`;

/**
 * Live alert feed.
 *
 * On a phone this is the primary surface, so it behaves like a notification
 * tray rather than a floating desktop panel: pinned to the bottom, full width,
 * collapsible to a single bar, individually dismissable, and height-capped so
 * it can never bury the page underneath.
 */
export default function AlertsFeed() {
  const { alerts, connected } = useAlerts();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);

  const visible = useMemo(
    () => alerts.filter((a) => !dismissed.has(keyOf(a))).slice(0, 6),
    [alerts, dismissed],
  );

  if (!visible.length) return null;

  const dismiss = (a: Alert) =>
    setDismissed((prev) => new Set(prev).add(keyOf(a)));
  const dismissAll = () =>
    setDismissed((prev) => {
      const next = new Set(prev);
      visible.forEach((a) => next.add(keyOf(a)));
      return next;
    });

  return (
    <div className="alerts" role="region" aria-label="Live alerts">
      <div className="alerts-bar">
        <button
          className="alerts-toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
        >
          <span className={`dot ${connected ? 'on' : 'off'}`} />
          {visible.length} live alert{visible.length === 1 ? '' : 's'}
          <span className="alerts-chevron">{collapsed ? '▲' : '▼'}</span>
        </button>
        <button className="alerts-clear" onClick={dismissAll}>
          Clear
        </button>
      </div>

      {!collapsed && (
        <div className="alerts-list">
          {visible.map((a) => (
            <div key={keyOf(a)} className={`alert ${a.severity}`}>
              <div className="alert-body">
                <strong>{a.type.replace(/_/g, ' ')}</strong>
                <div>{a.message}</div>
              </div>
              <button
                className="alert-dismiss"
                onClick={() => dismiss(a)}
                aria-label="Dismiss alert"
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
