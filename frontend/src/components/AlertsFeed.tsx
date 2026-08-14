import { useAlerts } from '../api/useAlerts';

/** Floating live-alert feed driven by the backend WebSocket. */
export default function AlertsFeed() {
  const { alerts, connected } = useAlerts();
  if (!alerts.length) return null;
  return (
    <div className="alerts">
      <div className="muted" style={{ fontSize: 12 }}>
        <span className={`dot ${connected ? 'on' : 'off'}`} /> live alerts
      </div>
      {alerts.slice(0, 6).map((a, i) => (
        <div key={i} className={`alert ${a.severity}`}>
          <strong>{a.type.replace(/_/g, ' ')}</strong>
          <div>{a.message}</div>
        </div>
      ))}
    </div>
  );
}
