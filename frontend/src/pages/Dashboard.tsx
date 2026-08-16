import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { ActivityLog, Device, Profile, RouterStatus, SystemHealth } from '../api/types';
import { ErrorNotice, Skeleton } from '../components/ui';

export default function Dashboard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [net, setNet] = useState<{ running: boolean; version: string | null }>();
  const [router, setRouter] = useState<RouterStatus>();
  const [health, setHealth] = useState<SystemHealth>();
  const [containing, setContaining] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Router status renders its own 'not configured' state; a failure here is
  // information, not an error worth a banner.
  const loadRouter = () => api.routerStatus().then(setRouter).catch(() => {});

  /**
   * The whole dashboard in one load, so a failure is one visible message with a
   * retry — rather than five silent catches leaving a page of zeros, which
   * reads as "the house is quiet and everything is fine": the most misleading
   * thing this page could say.
   */
  const load = () => {
    setLoadError(null);
    Promise.all([api.devices(), api.profiles(), api.activity(200)])
      .then(([d, p, a]) => {
        setDevices(d);
        setProfiles(p);
        setActivity(a);
      })
      .catch((e: unknown) =>
        setLoadError((e as Error)?.message || 'Could not load the dashboard.'),
      )
      .finally(() => setLoading(false));
    // Status probes degrade on their own terms — each renders its own state.
    api.networkStatus().then(setNet).catch(() => setNet({ running: false, version: null }));
    api.systemHealth().then(setHealth).catch(() => setHealth(undefined));
    loadRouter();
  };

  useEffect(() => {
    load();
    const t = setInterval(() => api.systemHealth().then(setHealth).catch(() => {}), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyContainment = async () => {
    setContaining(true);
    try {
      await api.applyContainment();
      await loadRouter();
    } finally {
      setContaining(false);
    }
  };

  const online = devices.filter((d) => d.isOnline).length;
  const randomized = devices.filter((d) => d.macRandomized).length;
  const blockedToday = activity.filter((a) => a.action === 'blocked').length;
  const pausedProfiles = profiles.filter((p) => p.internetPaused).length;

  return (
    <>
      <div className="header">
        <h1>Dashboard</h1>
        <div className="row">
          {health && (
            <span className={`badge ${health.healthy ? 'ok' : 'danger'}`} title={
              health.components.map((c) => `${c.name}: ${c.up ? 'up' : 'DOWN'}`).join(' · ')
            }>
              {health.healthy ? 'monitoring healthy' : 'component down'}
            </span>
          )}
          <span className={`badge ${net?.running ? 'ok' : 'danger'}`}>
            AdGuard {net?.running ? `up · ${net.version ?? ''}` : 'unreachable'}
          </span>
        </div>
      </div>

      {loadError && <ErrorNotice message={loadError} onRetry={load} />}

      {/* Zeros are a claim about the household, not a placeholder: showing
          "0 devices online" while still loading says the house is empty. */}
      {loading && <Skeleton rows={2} height={64} />}

      {!loading && (
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
      )}

      {/* Bedtime/quota state is invisible unless surfaced — a parent should see
          at a glance why a child has no internet right now. */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Bedtime &amp; limits</h2>
          <Link className="badge muted" to="/profiles">Manage in Profiles →</Link>
        </div>
        {profiles.length ? (
          <div className="grid" style={{ gap: 6 }}>
            {profiles.map((p) => (
              <div key={p.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span>{p.name}</span>
                <span className="row">
                  {p.dailyTimeLimitMinutes != null && (
                    <span className="badge muted">{p.dailyTimeLimitMinutes}m/day</span>
                  )}
                  {p.internetPaused ? (
                    <span className="badge danger">
                      {p.pausedReason === 'bedtime'
                        ? 'bedtime — internet off'
                        : p.pausedReason === 'quota_exceeded'
                          ? 'daily limit reached'
                          : 'paused'}
                    </span>
                  ) : (
                    <span className="badge ok">internet on</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">
            No profiles yet. Create one in Profiles, assign devices to it, then set a
            bedtime window — internet switches off automatically inside it.
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Router (bypass containment)</h2>
        {router?.enabled ? (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <span className={`badge ${router.reachable ? 'ok' : 'danger'}`}>
                {router.reachable ? `connected${router.model ? ' · ' + router.model : ''}` : 'unreachable'}
              </span>{' '}
              {router.containment.applied
                ? <span className="badge ok">containment on</span>
                : <span className="badge muted">containment off</span>}
              {!!router.containment.rules.length && (
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  {router.containment.rules.join(' · ')}
                </div>
              )}
            </div>
            <button onClick={applyContainment} disabled={containing || !router.reachable}>
              {containing ? 'Applying…' : 'Apply containment'}
            </button>
          </div>
        ) : (
          <div className="muted">
            No router configured. Set <code>ROUTER_PROVIDER=openwrt</code> to enable
            firewall-level cutoffs, VPN/DoT blocking, and per-device bandwidth.
          </div>
        )}
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
