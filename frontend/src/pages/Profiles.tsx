import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Profile, ProfileReport } from '../api/types';

const CATEGORIES = ['adult', 'social', 'gaming', 'video', 'gambling'];

export default function Profiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [name, setName] = useState('');
  const [report, setReport] = useState<{ id: string; data: ProfileReport } | null>(null);

  const load = () => {
    api.profiles().then(setProfiles).catch(() => {});
  };
  useEffect(load, []);

  const anyPaused = profiles.some((p) => p.internetPaused);
  const togglePauseAll = async () => {
    await api.pauseAll(!anyPaused);
    load();
  };
  const bonus = async (p: Profile, minutes: number) => {
    await api.bonusTime(p.id, minutes);
    load();
  };
  const showReport = async (id: string) => {
    if (report?.id === id) return setReport(null);
    setReport({ id, data: await api.report(id) });
  };

  const create = async () => {
    if (!name.trim()) return;
    await api.createProfile({ name: name.trim(), blockedCategories: ['adult'] });
    setName('');
    load();
  };
  const togglePause = async (p: Profile) => {
    await api.pauseProfile(p.id, !p.internetPaused);
    load();
  };
  const toggleCategory = async (p: Profile, cat: string) => {
    const set = new Set(p.blockedCategories);
    set.has(cat) ? set.delete(cat) : set.add(cat);
    await api.updateProfile(p.id, { blockedCategories: [...set] });
    load();
  };
  const setLimit = async (p: Profile, minutes: string) => {
    await api.updateProfile(p.id, {
      dailyTimeLimitMinutes: minutes ? Number(minutes) : null,
    });
    load();
  };

  return (
    <>
      <div className="header">
        <h1>Profiles</h1>
        <div className="row">
          {profiles.length > 0 && (
            <button className={anyPaused ? 'ghost' : 'danger'} onClick={togglePauseAll}>
              {anyPaused ? 'Resume all' : 'Pause all'}
            </button>
          )}
          <input placeholder="New profile (e.g. Sam)" value={name} onChange={(e) => setName(e.target.value)} />
          <button onClick={create}>Add</button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        {profiles.map((p) => (
          <div key={p.id} className="card">
            <div className="header" style={{ marginBottom: 12 }}>
              <div>
                <strong>{p.name}</strong>{' '}
                <span className="badge muted">{p.kind}</span>
              </div>
              <button className={p.internetPaused ? 'ghost' : 'danger'} onClick={() => togglePause(p)}>
                {p.internetPaused ? 'Resume' : 'Pause'}
              </button>
            </div>

            {p.internetPaused && (
              <div className="badge danger" style={{ marginBottom: 10 }}>
                paused · {p.pausedReason}
              </div>
            )}

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
                {report?.id === p.id ? 'Hide report' : 'Report'}
              </button>
            </div>

            {report?.id === p.id && <ReportPanel data={report.data} />}
          </div>
        ))}
        {!profiles.length && <div className="muted">No profiles yet — add one above.</div>}
      </div>
    </>
  );
}

/** 7-day screen-time + top domains for one profile. */
function ReportPanel({ data }: { data: ProfileReport }) {
  const maxMin = Math.max(60, ...data.last7Days.map((d) => d.usedMinutes));
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
        Today {data.today.usedMinutes}m
        {data.today.limitMinutes ? ` / ${data.today.limitMinutes}m` : ''}
        {data.today.bonusMinutes ? ` (+${data.today.bonusMinutes} bonus)` : ''}
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
