'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TopBar } from '../../components/theme/TopBar';
import { createZone, listZones, type Zone } from '../../lib/khuloh/client';
import { loadStoredUser, signalingUrl } from '../../lib/user-session';

export default function ZonesPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [city, setCity]   = useState('');
  const [name, setName]   = useState('');
  const [topic, setTopic] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async (filterCity?: string) => {
    const stored = loadStoredUser();
    if (!stored) { setError('Sign in to see Zones.'); setLoading(false); return; }
    try {
      const list = await listZones(signalingUrl(), stored.token, filterCity || undefined);
      setZones(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const stored = loadStoredUser();
    if (!stored) { setError('Sign in first.'); return; }
    try {
      await createZone(signalingUrl(), stored.token, { name, city, topic: topic || undefined });
      setName(''); setTopic('');
      await refresh(city);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <TopBar />
      <h1 style={{ fontSize: 24, marginTop: 16 }}>Zones</h1>
      <p style={{ opacity: 0.7, marginTop: 4 }}>Live rooms — meet, chat, vibe. Choose your city.</p>
      <p style={{ marginTop: 8 }}>
        <Link href="/zones/safe-spots">→ Browse Safe-Spots (verified IRL meet venues)</Link>
      </p>

      <section style={{ display: 'flex', gap: 8, margin: '16px 0', alignItems: 'center' }}>
        <input
          placeholder="Filter by city"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          style={{ flex: 1, padding: 8 }}
        />
        <button onClick={() => refresh(city)}>Apply</button>
      </section>

      <form onSubmit={handleCreate} style={{ marginBottom: 24, display: 'grid', gap: 8 }}>
        <strong>Create a Zone</strong>
        <input placeholder="Name (e.g. CPT Sundowner)" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="City (required)" value={city} onChange={(e) => setCity(e.target.value)} />
        <input placeholder="Topic (optional)" value={topic} onChange={(e) => setTopic(e.target.value)} />
        <button type="submit" disabled={!name || !city}>Create</button>
      </form>

      {error && <p style={{ color: 'tomato' }}>{error}</p>}
      {loading ? <p>Loading…</p> : zones.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No Zones yet. Be the first to start one.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {zones.map((z) => (
            <li key={z.id}>
              <Link
                href={`/zones/${z.id}`}
                style={{
                  display: 'block', padding: 12, borderRadius: 12,
                  background: 'var(--surface, #111)', textDecoration: 'none', color: 'inherit',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{z.name}</strong>
                  <span style={{ opacity: 0.6, fontSize: 12 }}>{z.city}</span>
                </div>
                {z.topic && <div style={{ opacity: 0.7, fontSize: 13, marginTop: 4 }}>{z.topic}</div>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
