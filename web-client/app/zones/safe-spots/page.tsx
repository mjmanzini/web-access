'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopBar } from '../../../components/theme/TopBar';
import { PanicButton } from '../../../lib/khuloh/panic';
import {
  listSafeSpots,
  scheduleMeetup,
  checkInMeetup,
  markMeetupSafe,
  markMeetupPanic,
  type SafeSpot,
  type Meetup,
} from '../../../lib/khuloh/client';
import { loadStoredUser, signalingUrl, type StoredUser } from '../../../lib/user-session';

interface Coords { lat: number; lng: number }

function useGeolocation() {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [busy, setBusy]     = useState(false);

  function locate() {
    if (!navigator.geolocation) { setError('geolocation_unavailable'); return; }
    setBusy(true); setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }); setBusy(false); },
      (e) => { setError(e.message); setBusy(false); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  return { coords, error, busy, locate };
}

export default function SafeSpotsPage() {
  const [user, setUser]   = useState<StoredUser | null>(null);
  const [spots, setSpots] = useState<SafeSpot[]>([]);
  const [city, setCity]   = useState('');
  const [err, setErr]     = useState<string | null>(null);
  const [activeMeetup, setActiveMeetup] = useState<Meetup | null>(null);
  const [peerId, setPeerId] = useState('');
  const geo = useGeolocation();

  useEffect(() => { setUser(loadStoredUser()); }, []);

  const load = useMemo(() => async () => {
    const u = loadStoredUser();
    if (!u) return;
    try {
      const list = await listSafeSpots(signalingUrl(), u.token, {
        city: city || undefined,
        lat: geo.coords?.lat,
        lng: geo.coords?.lng,
        radiusKm: geo.coords ? 50 : undefined,
      });
      setSpots(list);
    } catch (e) { setErr((e as Error).message); }
  }, [city, geo.coords]);

  useEffect(() => { void load(); }, [load]);

  async function startMeetup(spot: SafeSpot) {
    if (!user || !peerId.trim()) { setErr('peer_user_id_required'); return; }
    try {
      const m = await scheduleMeetup(signalingUrl(), user.token, {
        peerUserId: peerId.trim(),
        spotId: spot.id,
      });
      setActiveMeetup(m);
      setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }

  async function doCheckIn() {
    if (!user || !activeMeetup || !geo.coords) return;
    try {
      const m = await checkInMeetup(signalingUrl(), user.token, activeMeetup.id, geo.coords.lat, geo.coords.lng);
      setActiveMeetup(m);
      setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }

  async function doSafe() {
    if (!user || !activeMeetup) return;
    try {
      const m = await markMeetupSafe(signalingUrl(), user.token, activeMeetup.id);
      setActiveMeetup(m);
    } catch (e) { setErr((e as Error).message); }
  }

  async function doPanic() {
    if (!user || !activeMeetup) return;
    if (!confirm('Send a PANIC alert to your trusted contacts?')) return;
    try {
      const m = await markMeetupPanic(signalingUrl(), user.token, activeMeetup.id);
      setActiveMeetup(m);
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <main className="wa-hub">
      <TopBar />
      <div className="wa-hub-head">
        <span className="wa-kicker">Khuloh</span>
        <h1>Safe-Spots</h1>
        <p>Verified public venues where you can meet. GPS check-in within 100&nbsp;m unlocks the Vibe-Point reward.</p>
      </div>

      <section className="wa-waiting-room">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input
            placeholder="City (optional)"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
          <button className="add-contact-secondary" onClick={geo.locate} disabled={geo.busy}>
            {geo.busy ? 'Locating…' : geo.coords ? 'Re-locate' : 'Use my location'}
          </button>
          <Link href="/wallet" className="add-contact-secondary">Wallet</Link>
          <Link href="/zones" className="add-contact-secondary">Zones</Link>
          <Link href="/zones/safe-spots/scan" className="add-contact-secondary">Scan QR</Link>
        </div>
        {geo.error && <p style={{ color: 'tomato', fontSize: 13 }}>{geo.error}</p>}
        {err && <p style={{ color: 'tomato', fontSize: 13 }}>{err}</p>}
      </section>

      {activeMeetup && (
        <section className="wa-waiting-room">
          <h3 className="wa-settings-title">Active meetup · {activeMeetup.status}</h3>
          <p style={{ fontSize: 13, color: 'var(--wa-muted)' }}>
            With <code>{activeMeetup.b_uid === user?.id ? activeMeetup.a_uid : activeMeetup.b_uid}</code>
            &nbsp;at spot <code>{activeMeetup.spot_id}</code>
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="wa-primary-btn" onClick={doCheckIn} disabled={!geo.coords}>
              Check in (GPS)
            </button>
            <button className="wa-primary-btn" onClick={doSafe}>I'm safe</button>
            <button className="add-contact-secondary" onClick={doPanic} style={{ background: 'tomato', color: '#fff' }}>
              PANIC
            </button>
            <button className="add-contact-secondary" onClick={() => setActiveMeetup(null)}>Close</button>
          </div>
        </section>
      )}

      <section className="wa-waiting-room">
        <h3 className="wa-settings-title">Schedule with</h3>
        <input
          placeholder="Peer user id"
          value={peerId}
          onChange={(e) => setPeerId(e.target.value)}
        />
        <p style={{ fontSize: 12, color: 'var(--wa-muted)' }}>
          Pick a contact to meet, then choose a Safe-Spot below.
        </p>
      </section>

      <section className="wa-waiting-room">
        <h3 className="wa-settings-title">Spots near you</h3>
        {spots.length === 0 && <p>No spots loaded yet.</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {spots.map((s) => (
            <li key={s.id} className="wa-settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <strong>{s.name}</strong>
              <span style={{ fontSize: 13, color: 'var(--wa-muted)' }}>
                {s.city}{s.distance_km != null ? ` · ${s.distance_km.toFixed(1)} km away` : ''}
              </span>
              {s.address  && <span style={{ fontSize: 12 }}>{s.address}</span>}
              {s.deal_text && <span style={{ fontSize: 12, color: 'var(--wa-accent)' }}>{s.deal_text}</span>}
              <div className="row" style={{ gap: 8 }}>
                <button className="wa-primary-btn" onClick={() => startMeetup(s)} disabled={!peerId.trim()}>
                  Start meetup here
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <PanicButton />
    </main>
  );
}
