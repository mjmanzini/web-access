/**
 * khuloh/meetups.js — Phase 7. Tracks meet-ups arranged via the app.
 *
 * Lifecycle:  scheduled -> in_progress -> safe | missed | panic
 *
 * Storage: Firestore `khuloh_meetups`. Falls back to memory in dev.
 *
 * REST:
 *   POST  /api/khuloh/meetups                       schedule
 *   POST  /api/khuloh/meetups/:id/check-in          { lat, lng }   GPS-gated
 *   POST  /api/khuloh/meetups/:id/safe              two-party safe signal
 *   POST  /api/khuloh/meetups/:id/panic             escalate to panic flow
 *   GET   /api/khuloh/meetups/mine                  list my upcoming/recent
 */
import crypto from 'node:crypto';
import { getFirestore } from './firestore.js';
import { getSafeSpot, safeSpotMath } from './safe-spots.js';
import { credit } from './wallet.js';
import { triggerPanic } from './panic.js';

const memMeetups = new Map();
const CHECKIN_RADIUS_KM = 0.1; // 100 m

function nowIso() { return new Date().toISOString(); }

async function readMeetup(id) {
  const db = await getFirestore();
  if (!db) return memMeetups.get(id) || null;
  const snap = await db.collection('khuloh_meetups').doc(id).get();
  return snap.exists ? snap.data() : null;
}

async function writeMeetup(meetup) {
  const db = await getFirestore();
  if (!db) { memMeetups.set(meetup.id, meetup); return; }
  await db.collection('khuloh_meetups').doc(meetup.id).set(meetup, { merge: true });
}

export async function scheduleMeetup({ aUid, bUid, spotId, scheduledFor }) {
  if (!aUid || !bUid || aUid === bUid) throw new Error('two_distinct_users_required');
  if (!spotId) throw new Error('spot_required');
  const spot = await getSafeSpot(spotId);
  if (!spot) throw new Error('spot_not_found');
  const meetup = {
    id: crypto.randomUUID(),
    a_uid: aUid,
    b_uid: bUid,
    spot_id: spotId,
    scheduled_for: scheduledFor || nowIso(),
    started_at: null,
    a_checked_in_at: null,
    b_checked_in_at: null,
    a_safe_at: null,
    b_safe_at: null,
    status: 'scheduled',
    created_at: nowIso(),
  };
  await writeMeetup(meetup);
  return meetup;
}

export async function checkIn({ meetupId, uid, lat, lng }) {
  const meetup = await readMeetup(meetupId);
  if (!meetup) throw new Error('meetup_not_found');
  if (meetup.a_uid !== uid && meetup.b_uid !== uid) throw new Error('not_a_party');
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) throw new Error('coords_required');

  const spot = await getSafeSpot(meetup.spot_id);
  if (!spot || !spot.active) throw new Error('spot_inactive');

  const distance = safeSpotMath.haversineKm({ lat: Number(lat), lng: Number(lng) }, spot);
  if (distance > CHECKIN_RADIUS_KM) {
    throw Object.assign(new Error('too_far_from_spot'), { code: 'too_far_from_spot', distance_km: distance });
  }

  const update = {};
  if (meetup.a_uid === uid) update.a_checked_in_at = nowIso();
  if (meetup.b_uid === uid) update.b_checked_in_at = nowIso();
  Object.assign(meetup, update);
  if (meetup.a_checked_in_at && meetup.b_checked_in_at && meetup.status === 'scheduled') {
    meetup.status = 'in_progress';
    meetup.started_at = nowIso();
  }
  await writeMeetup(meetup);
  return meetup;
}

export async function markSafe({ meetupId, uid }) {
  const meetup = await readMeetup(meetupId);
  if (!meetup) throw new Error('meetup_not_found');
  if (meetup.a_uid !== uid && meetup.b_uid !== uid) throw new Error('not_a_party');

  if (meetup.a_uid === uid) meetup.a_safe_at = nowIso();
  if (meetup.b_uid === uid) meetup.b_safe_at = nowIso();

  if (meetup.a_safe_at && meetup.b_safe_at && meetup.status !== 'safe') {
    meetup.status = 'safe';
    // reward both parties for a verified safe meetup
    Promise.allSettled([
      credit(meetup.a_uid, 50, 'safe_meetup', meetup.id),
      credit(meetup.b_uid, 50, 'safe_meetup', meetup.id),
    ]).catch(() => {});
  }
  await writeMeetup(meetup);
  return meetup;
}

export async function markPanic({ meetupId, uid, note }) {
  const meetup = await readMeetup(meetupId);
  if (!meetup) throw new Error('meetup_not_found');
  if (meetup.a_uid !== uid && meetup.b_uid !== uid) throw new Error('not_a_party');
  meetup.status = 'panic';
  meetup.panic_at = nowIso();
  meetup.panic_by = uid;
  await writeMeetup(meetup);
  triggerPanic({ uid, source: 'meetup', meetupId, note }).catch((err) => {
    console.error('[khuloh/panic] fan-out failed:', err.message);
  });
  return meetup;
}

export async function listMyMeetups(uid) {
  const db = await getFirestore();
  if (!db) {
    return Array.from(memMeetups.values()).filter((m) => m.a_uid === uid || m.b_uid === uid);
  }
  const [a, b] = await Promise.all([
    db.collection('khuloh_meetups').where('a_uid', '==', uid).limit(50).get(),
    db.collection('khuloh_meetups').where('b_uid', '==', uid).limit(50).get(),
  ]);
  const all = [...a.docs, ...b.docs].map((d) => d.data());
  const seen = new Set();
  return all.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .sort((x, y) => (y.created_at || '').localeCompare(x.created_at || ''));
}

export function _resetMeetups() {
  memMeetups.clear();
}

export function attachMeetupRoutes(app, requireAuth) {
  app.post('/api/khuloh/meetups', requireAuth, async (req, res) => {
    try {
      const { peerUserId, spotId, scheduledFor } = req.body || {};
      const meetup = await scheduleMeetup({
        aUid: req.user.id,
        bUid: peerUserId,
        spotId,
        scheduledFor,
      });
      res.json({ meetup });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/khuloh/meetups/:id/check-in', requireAuth, async (req, res) => {
    try {
      const meetup = await checkIn({
        meetupId: req.params.id,
        uid: req.user.id,
        lat: req.body?.lat,
        lng: req.body?.lng,
      });
      res.json({ meetup });
    } catch (err) {
      const status = err.code === 'too_far_from_spot' ? 409 : 400;
      res.status(status).json({ error: err.message, distance_km: err.distance_km });
    }
  });

  app.post('/api/khuloh/meetups/:id/safe', requireAuth, async (req, res) => {
    try {
      const meetup = await markSafe({ meetupId: req.params.id, uid: req.user.id });
      res.json({ meetup });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/khuloh/meetups/:id/panic', requireAuth, async (req, res) => {
    try {
      const meetup = await markPanic({
        meetupId: req.params.id,
        uid: req.user.id,
        note: req.body?.note,
      });
      res.json({ meetup });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/khuloh/meetups/mine', requireAuth, async (req, res) => {
    try {
      const meetups = await listMyMeetups(req.user.id);
      res.json({ meetups });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
