import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Profile, ProfileReport, Schedule } from '../api/types';
import { EmptyState, ErrorNotice, Skeleton, useConfirm } from '../components/ui';

const CATEGORIES = ['adult', 'social', 'gaming', 'video', 'gambling'];

export default function Profiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [name, setName] = useState('');
  const [report, setReport] = useState<{ id: string; data: ProfileReport } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingReport, setLoadingReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<Record<string, ProfileReport> | null>(null);
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.profiles()
      .then(setProfiles)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // Usage for every card in one call. Deliberately not fatal: if this fails
    // the cards still render with their controls, just without the summary
    // line — the page's job is to control the internet, not to report on it.
    api.reports()
      .then((rows) => setUsage(Object.fromEntries(rows.map((r) => [r.profileId, r]))))
      .catch(() => setUsage({}));
  };
  useEffect(load, []);

  /**
   * Every control on this page is a write that can fail. Before this, each
   * handler awaited the API with no catch: a rejected request vanished into an
   * unhandled promise and the button simply did nothing — no spinner, no error,
   * nothing to tell a parent whether the thing they just tapped worked. Route
   * every mutation through here so a failure is always visible and a slow
   * request always looks slow.
   */
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error).message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const anyPaused = profiles.some((p) => p.internetPaused);
  const togglePauseAll = async () => {
    if (!anyPaused) {
      const ok = await confirm({
        title: 'Pause the internet for everyone?',
        body: `All ${profiles.length} profile(s) lose internet until you resume them.`,
        confirmLabel: 'Pause everyone',
        danger: true,
      });
      if (!ok) return;
    }
    return run(() => api.pauseAll(!anyPaused));
  };
  const bonus = (p: Profile, minutes: number) => run(() => api.bonusTime(p.id, minutes));
  const showReport = async (id: string) => {
    if (report?.id === id) return setReport(null);
    // Fetching a week of activity is not instant on a phone; without this the
    // button looks inert and gets tapped again.
    setLoadingReport(id);
    try {
      await run(async () => setReport({ id, data: await api.report(id) }));
    } finally {
      setLoadingReport(null);
    }
  };

  const create = () =>
    run(async () => {
      // An empty name used to return silently, which looks exactly like a
      // broken button — say what is missing instead.
      if (!name.trim()) throw new Error('Enter a name for the profile first.');
      await api.createProfile({ name: name.trim(), blockedCategories: ['adult'] });
      setName('');
    });
  const togglePause = (p: Profile) => run(() => api.pauseProfile(p.id, !p.internetPaused));

  /** The two independent inputs. Each just sets a field; the backend
      recomputes the effective state and pushes enforcement immediately. */
  const setSwitch = async (p: Profile, internetSwitch: 'auto' | 'off') => {
    // The highest-impact control on the page: it takes a child offline and
    // keeps them there, overriding bedtime and limits both.
    if (internetSwitch === 'off') {
      const devices = (p.devices ?? []).map((d) => d.name).join(', ');
      const ok = await confirm({
        title: `Switch off the internet for ${p.name}?`,
        body: devices
          ? `${devices} loses internet straight away and stays off until you switch it back on — bedtime and daily limits will not turn it back on.`
          : 'Their devices lose internet straight away and stay off until you switch it back on.',
        confirmLabel: 'Switch it off',
        danger: true,
      });
      if (!ok) return;
    }
    return run(() => api.updateProfile(p.id, { internetSwitch }));
  };
  const setBedtime = (p: Profile, bedtimeEnabled: boolean) =>
    run(() => api.updateProfile(p.id, { bedtimeEnabled }));
  const toggleCategory = (p: Profile, cat: string) => {
    const set = new Set(p.blockedCategories);
    set.has(cat) ? set.delete(cat) : set.add(cat);
    return run(() => api.updateProfile(p.id, { blockedCategories: [...set] }));
  };
  const setLimit = (p: Profile, minutes: string) =>
    run(() =>
      api.updateProfile(p.id, {
        dailyTimeLimitMinutes: minutes ? Number(minutes) : null,
      }),
    );

  return (
    <>
      <div className="header">
        <h1>Profiles</h1>
        <div className="row">
          {profiles.length > 0 && (
            <button
              className={anyPaused ? 'ghost' : 'danger'}
              onClick={togglePauseAll}
              disabled={busy}
            >
              {anyPaused ? 'Resume all' : 'Pause all'}
            </button>
          )}
          {/* A real form, so the phone keyboard's "Go" key submits it. As a
              bare input + button, Enter did nothing and the only way to add a
              profile was to dismiss the keyboard and find the button. */}
          <form
            className="row"
            style={{ flex: '1 1 220px', minWidth: 0 }}
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <input
              placeholder="New profile (e.g. Sam)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              // Without a flex basis the input keeps its intrinsic ~200px and
              // pushes Add off the row on a narrow screen.
              style={{ flex: '1 1 120px', minWidth: 0 }}
              enterKeyHint="done"
              autoCapitalize="words"
              autoCorrect="off"
            />
            <button type="submit" disabled={busy}>
              {busy ? 'Adding…' : 'Add'}
            </button>
          </form>
        </div>
      </div>

      {error && (
        <div
          className="card"
          role="alert"
          style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: 16 }}
        >
          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <span>{error}</span>
            <button className="ghost" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Loading and "there genuinely are none" must look different. */}
      {loading && <Skeleton rows={3} height={90} />}
      {!loading && !profiles.length && (
        <EmptyState
          icon="👤"
          title="No profiles yet"
          hint="Add one above, then assign a device to it on the Devices page."
        />
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        {profiles.map((p) => (
          <div key={p.id} className="card">
            <div className="header" style={{ marginBottom: 12 }}>
              <div>
                <strong>{p.name}</strong>{' '}
                <span className="badge muted">{p.kind}</span>
              </div>
            </div>

            {/* Effective state first, in plain words: what IS happening, and
                why. The switches below are the two inputs that decide it. */}
            <div
              className={`badge ${p.internetPaused ? 'danger' : 'ok'}`}
              style={{ marginBottom: 12, display: 'block' }}
            >
              {effectiveSummary(p)}
            </div>

            {/* Usage where it was asked for: on the card, without a tap. The
                full per-device breakdown stays behind Report — this is the
                answer to "how much today", not the analysis. */}
            <UsageLine report={usage?.[p.id]} loading={usage === null} />

            <div className="grid" style={{ gap: 8, marginBottom: 12 }}>
              <Toggle
                label="Internet"
                on={p.internetSwitch !== 'off'}
                onLabel="Auto (schedule decides)"
                offLabel="Off — blocked no matter what"
                onChange={(on) => setSwitch(p, on ? 'auto' : 'off')}
              />
              <Toggle
                label="Bedtime schedule"
                on={p.bedtimeEnabled !== false}
                onLabel="On"
                offLabel="Off — windows ignored"
                onChange={(on) => setBedtime(p, on)}
              />
            </div>

            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Blocked categories</div>
            <div className="row" style={{ marginBottom: 12 }}>
              {CATEGORIES.map((c) => {
                const on = p.blockedCategories.includes(c);
                return (
                  <button
                    key={c}
                    className={on ? 'danger' : 'ghost'}
                    style={{ padding: '4px 10px', fontSize: 12 }}
                    onClick={() => toggleCategory(p, c)}
                  >
                    {c}
                  </button>
                );
              })}
            </div>

            <div className="row">
              <label className="muted" style={{ fontSize: 12 }}>Daily limit (min)</label>
              <input
                type="number"
                style={{ width: 90 }}
                defaultValue={p.dailyTimeLimitMinutes ?? ''}
                onBlur={(e) => setLimit(p, e.target.value)}
              />
              <span className="badge muted">
                {p.safeSearchEnforced ? 'SafeSearch' : 'no SafeSearch'}
              </span>
            </div>

            <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
              <div className="row">
                <span className="muted" style={{ fontSize: 12 }}>Bonus</span>
                <button className="ghost" style={{ padding: '4px 10px' }} onClick={() => bonus(p, 15)}>+15m</button>
                <button className="ghost" style={{ padding: '4px 10px' }} onClick={() => bonus(p, 30)}>+30m</button>
              </div>
              <button className="ghost" style={{ padding: '4px 10px' }} onClick={() => showReport(p.id)}>
                {loadingReport === p.id
                  ? 'Loading…'
                  : report?.id === p.id
                    ? 'Hide report'
                    : 'Report'}
              </button>
            </div>

            <Bedtime profileId={p.id} />

            {report?.id === p.id && <ReportPanel data={report.data} />}
          </div>
        ))}
        {!profiles.length && <div className="muted">No profiles yet — add one above.</div>}
      </div>
    </>
  );
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** What's actually happening to this profile right now, and why. */
function effectiveSummary(p: Profile): string {
  if (!p.internetPaused) return 'On';
  switch (p.pausedReason) {
    case 'manual':
      return 'Off — switched off by you';
    case 'bedtime':
      return 'Off — bedtime';
    case 'quota_exceeded':
      return `Off — daily limit reached${p.dailyTimeLimitMinutes ? ` (${p.dailyTimeLimitMinutes} min)` : ''}`;
    default:
      return 'Off';
  }
}

/** A switch, not a button: its position shows the current setting. */
function Toggle({
  label,
  on,
  onLabel,
  offLabel,
  onChange,
}: {
  label: string;
  on: boolean;
  onLabel: string;
  offLabel: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div className="muted" style={{ fontSize: 11 }}>{on ? onLabel : offLabel}</div>
      </div>
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={on ? '' : 'ghost'}
        style={{
          minWidth: 62,
          padding: '6px 10px',
          borderRadius: 999,
          background: on ? 'var(--ok)' : 'var(--panel-2)',
          color: on ? '#0f1420' : 'var(--muted)',
        }}
      >
        {on ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

/**
 * Bedtime / block windows for a profile. The backend already enforces these
 * every minute (pausing the profile with reason "bedtime"); this is the UI for
 * them. A window may cross midnight — 21:00→06:00 is the common case.
 */
function Bedtime({ profileId }: { profileId: string }) {
  const confirm = useConfirm();
  const [items, setItems] = useState<Schedule[]>([]);
  const [schedLoading, setSchedLoading] = useState(true);
  const [schedErr, setSchedErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('21:00');
  const [end, setEnd] = useState('06:00');
  const [label, setLabel] = useState('Bedtime');
  const [days, setDays] = useState<string[]>(['0', '1', '2', '3', '4', '5', '6']);

  const load = () =>
    api
      .schedules(profileId)
      .then(setItems)
      .catch((e: unknown) => setSchedErr((e as Error)?.message || 'Could not load bedtime windows.'))
      .finally(() => setSchedLoading(false));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  const add = async () => {
    await api.createSchedule(profileId, { label, startTime: start, endTime: end, daysOfWeek: days, enabled: true });
    setOpen(false);
    setLabel('Bedtime');
    load();
  };
  const toggle = async (s: Schedule) => {
    await api.updateSchedule(s.id, { enabled: !s.enabled });
    load();
  };
  const remove = async (s: Schedule) => {
    const ok = await confirm({
      title: `Delete "${s.label}"?`,
      body: `The ${s.startTime}–${s.endTime} window goes away, and the internet will no longer switch off then.`,
      confirmLabel: 'Delete it',
      danger: true,
    });
    if (!ok) return;
    await api.deleteSchedule(s.id);
    load();
  };
  const toggleDay = (d: string) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  const daySummary = (s: Schedule) =>
    !s.daysOfWeek?.length || s.daysOfWeek.length === 7
      ? 'every day'
      : s.daysOfWeek.map((d) => DAY_LABELS[Number(d)]).join(' ');

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--panel-2)', paddingTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          Bedtime &amp; block windows
        </span>
        <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setOpen((v) => !v)}>
          {open ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {items.map((s) => (
        <div key={s.id} className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <div>
            <strong style={{ fontSize: 13 }}>{s.startTime}–{s.endTime}</strong>{' '}
            <span className="muted" style={{ fontSize: 12 }}>{s.label} · {daySummary(s)}</span>
          </div>
          <div className="row">
            <button
              className={s.enabled ? 'ghost' : 'ghost'}
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => toggle(s)}
            >
              {s.enabled ? 'on' : 'off'}
            </button>
            <button className="ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => remove(s)}>
              ✕
            </button>
          </div>
        </div>
      ))}
      {!items.length && !open && (
        <div className="muted" style={{ fontSize: 12 }}>
          No bedtime set — internet stays on around the clock.
        </div>
      )}

      {open && (
        <div className="grid" style={{ gap: 8, marginTop: 8 }}>
          <div className="row">
            <input value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: 120 }} placeholder="Label" />
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={{ width: 110 }} />
            <span className="muted">to</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={{ width: 110 }} />
          </div>
          <div className="row">
            {DAY_LABELS.map((d, i) => (
              <button
                key={d}
                className={days.includes(String(i)) ? '' : 'ghost'}
                style={{ padding: '3px 8px', fontSize: 11 }}
                onClick={() => toggleDay(String(i))}
              >
                {d}
              </button>
            ))}
          </div>
          <button onClick={add} disabled={!days.length}>Save window</button>
        </div>
      )}
    </div>
  );
}

/** 7-day screen-time + top domains for one profile. */
function ReportPanel({ data }: { data: ProfileReport }) {
  const maxMin = Math.max(60, ...data.last7Days.map((d) => d.usedMinutes));
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      {/* Headline numbers first. The report used to open on a one-bar sparkline
          and "No history yet", which reads as a button that did nothing. */}
      <div className="cards" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
        <div>
          <div className="stat" style={{ fontSize: 22 }}>{data.today.usedMinutes}m</div>
          <div className="muted" style={{ fontSize: 11 }}>
            online today
            {data.today.limitMinutes ? ` / ${data.today.limitMinutes}m` : ''}
            {data.today.bonusMinutes ? ` (+${data.today.bonusMinutes})` : ''}
          </div>
        </div>
        <div>
          <div className="stat" style={{ fontSize: 22 }}>
            {(data.deviceTotals?.lookupsToday ?? 0).toLocaleString()}
          </div>
          <div className="muted" style={{ fontSize: 11 }}>requests today</div>
        </div>
        <div>
          <div className="stat" style={{ fontSize: 22, color: 'var(--danger)' }}>
            {(data.deviceTotals?.blockedToday ?? 0).toLocaleString()}
          </div>
          <div className="muted" style={{ fontSize: 11 }}>blocked today</div>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
        Last 7 days
      </div>
      {/* simple 7-day bar sparkline */}
      <div className="row" style={{ alignItems: 'flex-end', gap: 4, height: 48 }}>
        {data.last7Days.map((d) => (
          <div
            key={d.date}
            title={`${d.date}: ${d.usedMinutes}m`}
            style={{
              flex: 1,
              height: `${Math.round((d.usedMinutes / maxMin) * 100)}%`,
              minHeight: 2,
              background: 'var(--accent)',
              borderRadius: 3,
            }}
          />
        ))}
      </div>
      <DeviceUsage data={data} />

      <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Top domains (7d)</div>
      {data.topDomains.length ? (
        data.topDomains.slice(0, 5).map((t) => (
          <div key={t.domain} className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
            <span>{t.domain}</span>
            <span className="muted">{t.hits}</span>
          </div>
        ))
      ) : (
        <div className="muted" style={{ fontSize: 13 }}>No history yet.</div>
      )}
    </div>
  );
}

/**
 * Per-device usage for a profile.
 *
 * The obvious ask was megabytes, and the honest answer is that nothing here can
 * measure them: AdGuard sees DNS lookups, not traffic, and this router's API
 * exposes only whole-WAN totals — no per-host counters at any endpoint. So this
 * reports what IS measured, and says so, rather than showing a plausible number
 * that would be fiction. "Active" is the same measure the daily limit enforces,
 * which also means the two can never disagree.
 */
function DeviceUsage({ data }: { data: ProfileReport }) {
  const devices = data.devices ?? [];
  if (!devices.length) {
    return (
      <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        No devices assigned to this profile yet.
      </div>
    );
  }

  // Busiest first — that is the question a parent is actually asking.
  const sorted = [...devices].sort(
    (a, b) => b.activeMinutesToday - a.activeMinutesToday || b.lookupsToday - a.lookupsToday,
  );
  const busiest = Math.max(1, ...sorted.map((d) => d.activeMinutesToday));

  return (
    <div style={{ marginTop: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>Usage by device</span>
        <span className="muted" style={{ fontSize: 11 }}>
          {data.deviceTotals?.activeMinutesToday ?? 0}m active today
        </span>
      </div>

      {sorted.map((d) => (
        <div key={d.deviceId} style={{ marginBottom: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
              <span className={`dot ${d.isOnline ? 'on' : 'off'}`} /> {d.name}
            </span>
            <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
              <strong>{d.activeMinutesToday}m</strong>{' '}
              <span className="muted">today</span>
            </span>
          </div>
          {/* Bar is relative to the busiest device, so the comparison is the
              point rather than the absolute number. */}
          <div style={{ height: 6, background: 'var(--panel-2)', borderRadius: 3, marginTop: 4 }}>
            <div
              style={{
                width: `${Math.round((d.activeMinutesToday / busiest) * 100)}%`,
                height: '100%',
                background: 'var(--accent)',
                borderRadius: 3,
                minWidth: d.activeMinutesToday ? 3 : 0,
              }}
            />
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
            {d.activeMinutesWeek}m this week · {d.lookupsToday.toLocaleString()} lookups today
            {d.blockedToday > 0 && ` · ${d.blockedToday.toLocaleString()} blocked`}
            {d.topDomain && ` · mostly ${d.topDomain}`}
          </div>
        </div>
      ))}

      <div className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
        Measured from DNS activity — minutes a device was actually using the
        internet, and how many lookups it made. Not megabytes: the filter sees
        which sites a device asks for, not how much it downloads, and this
        router reports no per-device data totals.
      </div>
    </div>
  );
}

/**
 * One line of usage, always visible on the card.
 *
 * The full breakdown lives behind the Report button, which turned out to be
 * three interactions deep — past the switches, the categories, the limit and
 * the whole bedtime section — so "per-device usage under the profile" was
 * shipped and effectively invisible. This is the at-a-glance answer; Report is
 * still where the detail is.
 */
function UsageLine({ report, loading }: { report?: ProfileReport; loading: boolean }) {
  if (loading) {
    return (
      <div style={{ marginBottom: 12 }}>
        <Skeleton rows={1} height={13} />
      </div>
    );
  }
  if (!report) return null;

  const devices = report.devices ?? [];
  if (!devices.length) {
    return (
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        No devices assigned yet — usage appears once one is.
      </div>
    );
  }

  // Busiest first: with several devices the card should lead with the one
  // actually being used, not whichever the database returned first.
  const sorted = [...devices].sort((a, b) => b.activeMinutesToday - a.activeMinutesToday);
  const shown = sorted.slice(0, 2);
  const rest = sorted.length - shown.length;

  return (
    <div style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
      {shown.map((d) => (
        <div key={d.deviceId} style={{ overflowWrap: 'anywhere' }}>
          <span className={`dot ${d.isOnline ? 'on' : 'off'}`} />{' '}
          <strong>{d.name}</strong>{' '}
          <span className="muted">
            · {d.activeMinutesToday}m today
            {d.blockedToday > 0 && ` · ${d.blockedToday.toLocaleString()} blocked`}
          </span>
        </div>
      ))}
      {rest > 0 && (
        <div className="muted">
          + {rest} more device{rest === 1 ? '' : 's'} · see Report
        </div>
      )}
    </div>
  );
}
