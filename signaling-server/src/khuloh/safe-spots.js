/**
 * khuloh/safe-spots.js — Phase 7 Safe-Spot partner network.
 *
 * Curated, partner-vetted public venues where verified users can meet.
 * Stored in Firestore (`khuloh_safe_spots`) with a tiny in-memory fallback
 * for local dev. Public read, admin-only write (gated by KHULOH_ADMIN_KEY
 * env var so we don't need to invent a roles system yet).
 *
 * REST:
 *   GET  /api/khuloh/safe-spots?city=&lat=&lng=&radiusKm=
 *   POST /api/khuloh/safe-spots                     (header X-Khuloh-Admin-Key)
 *   PATCH /api/khuloh/safe-spots/:id                (header X-Khuloh-Admin-Key)
 */
import crypto from 'node:crypto';
import { getFirestore } from './firestore.js';

const memSpots = new Map();
const NEARBY_TTL_MS = 60_000;
const cache = new Map(); // key -> { at, value }

function nowIso() { return new Date().toISOString(); }

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

function normSpot(input, existing = null) {
  const id = existing?.id || crypto.randomUUID();
  return {
    id,
    name:        String(input.name || existing?.name || '').trim().slice(0, 120),
    city:        String(input.city || existing?.city || '').trim().slice(0, 64),
    lat:         Number.isFinite(Number(input.lat)) ? Number(input.lat) : existing?.lat,
    lng:         Number.isFinite(Number(input.lng)) ? Number(input.lng) : existing?.lng,
    address:     input.address != null ? String(input.address).slice(0, 240) : existing?.address || null,
    deal_text:   input.deal_text != null ? String(input.deal_text).slice(0, 200) : existing?.deal_text || null,
    partner_id:  input.partner_id != null ? String(input.partner_id) : existing?.partner_id || null,
    active:      typeof input.active === 'boolean' ? input.active : existing?.active ?? true,
    created_at:  existing?.created_at || nowIso(),
    updated_at:  nowIso(),
  };
}

export async function listSafeSpots({ city, lat, lng, radiusKm } = {}) {
  const key = JSON.stringify({ city: city || '', lat: lat ?? '', lng: lng ?? '', radiusKm: radiusKm ?? '' });
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < NEARBY_TTL_MS) return hit.value;

  const db = await getFirestore();
  let spots;
  if (!db) {
    spots = Array.from(memSpots.values()).filter((s) => s.active);
  } else {
    let q = db.collection('khuloh_safe_spots').where('active', '==', true);
    if (city) q = q.where('city', '==', city);
    const snap = await q.limit(200).get();
    spots = snap.docs.map((d) => d.data());
  }

  if (lat != null && lng != null) {
    const origin = { lat: Number(lat), lng: Number(lng) };
    const r = Number(radiusKm) || 25;
    spots = spots
      .map((s) => ({ ...s, distance_km: haversineKm(origin, s) }))
      .filter((s) => Number.isFinite(s.distance_km) && s.distance_km <= r)
      .sort((a, b) => a.distance_km - b.distance_km);
  }

  cache.set(key, { at: Date.now(), value: spots });
  return spots;
}

export async function getSafeSpot(id) {
  const db = await getFirestore();
  if (!db) return memSpots.get(id) || null;
  const snap = await db.collection('khuloh_safe_spots').doc(id).get();
  return snap.exists ? snap.data() : null;
}

export async function upsertSafeSpot(input) {
  if (!input.name || !input.city) throw new Error('name_and_city_required');
  if (!Number.isFinite(Number(input.lat)) || !Number.isFinite(Number(input.lng))) {
    throw new Error('lat_lng_required');
  }
  const existing = input.id ? await getSafeSpot(input.id) : null;
  const spot = normSpot(input, existing);
  const db = await getFirestore();
  if (!db) {
    memSpots.set(spot.id, spot);
  } else {
    await db.collection('khuloh_safe_spots').doc(spot.id).set(spot, { merge: true });
  }
  cache.clear();
  return spot;
}

function checkAdmin(req) {
  const expected = process.env.KHULOH_ADMIN_KEY;
  if (!expected) return false;
  return req.header('x-khuloh-admin-key') === expected;
}

export function attachSafeSpotRoutes(app, requireAuth) {
  app.get('/api/khuloh/safe-spots', async (req, res) => {
    try {
      const spots = await listSafeSpots({
        city:     req.query.city ? String(req.query.city) : undefined,
        lat:      req.query.lat,
        lng:      req.query.lng,
        radiusKm: req.query.radiusKm,
      });
      res.json({ spots });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/khuloh/safe-spots', async (req, res) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'admin_key_required' });
    try {
      const spot = await upsertSafeSpot(req.body || {});
      res.json({ spot });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch('/api/khuloh/safe-spots/:id', async (req, res) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'admin_key_required' });
    try {
      const spot = await upsertSafeSpot({ ...(req.body || {}), id: req.params.id });
      res.json({ spot });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
}

export const safeSpotMath = { haversineKm };

export function _resetSafeSpots() {
  memSpots.clear();
  cache.clear();
}
