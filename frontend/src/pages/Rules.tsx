import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Profile, Rule } from '../api/types';

export default function Rules() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [domain, setDomain] = useState('');
  const [scope, setScope] = useState<'global' | 'profile'>('global');
  const [profileId, setProfileId] = useState('');

  const load = () => {
    api.rules().then(setRules).catch(() => {});
    api.profiles().then(setProfiles).catch(() => {});
  };
  useEffect(load, []);

  const add = async () => {
    if (!domain.trim()) return;
    await api.createRule({
      type: 'domain',
      value: domain.trim(),
      action: 'block',
      scope,
      profileId: scope === 'profile' ? profileId || undefined : undefined,
    });
    setDomain('');
    load();
  };
  const del = async (id: string) => {
    await api.deleteRule(id);
    load();
  };

  return (
    <>
      <div className="header"><h1>Rules</h1></div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Block a domain</h2>
        <div className="row">
          <input placeholder="e.g. tiktok.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
          <select value={scope} onChange={(e) => setScope(e.target.value as 'global' | 'profile')}>
            <option value="global">Everyone</option>
            <option value="profile">One profile</option>
          </select>
          {scope === 'profile' && (
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="">Select profile…</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button onClick={add}>Block</button>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th>Value</th><th>Type</th><th>Action</th><th>Scope</th><th></th></tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.value}</td>
                <td className="muted">{r.type}</td>
                <td>
                  <span className={`badge ${r.action === 'block' ? 'danger' : 'ok'}`}>{r.action}</span>
                </td>
                <td className="muted">
                  {r.scope}
                  {r.profileId && ' · ' + (profiles.find((p) => p.id === r.profileId)?.name ?? '')}
                </td>
                <td><button className="ghost" onClick={() => del(r.id)}>Delete</button></td>
              </tr>
            ))}
            {!rules.length && <tr><td colSpan={5} className="muted">No custom rules yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
