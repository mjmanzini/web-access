import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Profile } from '../api/types';

const CATEGORIES = ['adult', 'social', 'gaming', 'video', 'gambling'];

export default function Profiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [name, setName] = useState('');

  const load = () => {
    api.profiles().then(setProfiles).catch(() => {});
  };
  useEffect(load, []);

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
          </div>
        ))}
        {!profiles.length && <div className="muted">No profiles yet — add one above.</div>}
      </div>
    </>
  );
}
