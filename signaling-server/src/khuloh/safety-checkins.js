import crypto from 'node:crypto';
import { getFirestore } from './firestore.js';
import { triggerPanic } from './panic.js';

const memCheckins = new Map();

function nowIso() { return new Date().toISOString(); }

async function readCheckin(id) {
  const db = await getFirestore();
  if (!db) return memCheckins.get(id) || null;
  const snap = await db.collection('khuloh_safety_checkins').doc(id).get();
  return snap.exists ? snap.data() : null;
}

async function writeCheckin(checkin) {
  const db = await getFirestore();
  if (!db) {
    memCheckins.set(checkin.id, checkin);
    return;
  }
  await db.collection('khuloh_safety_checkins').doc(checkin.id).set(checkin, { merge: true });
}

function normalizeCoords(lat, lng) {
  const nextLat = lat == null ? null : Number(lat);
  const nextLng = lng == null ? null : Number(lng);
  if (lat != null && !Number.isFinite(nextLat)) throw new Error('lat_invalid');
  if (lng != null && !Number.isFinite(nextLng)) throw new Error('lng_invalid');
  return { lat: nextLat, lng: nextLng };
}

function normalizeCheckAt(checkAt) {
  const iso = checkAt ? new Date(checkAt).toISOString() : new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  if (Number.isNaN(Date.parse(iso))) throw new Error('check_at_invalid');
  return iso;
}

export async function createSafetyCheckin({ uid, metUserId, checkAt, lat = null, lng = null, meetupId = null }) {
  if (!uid) throw new Error('uid_required');
  if (!metUserId) throw new Error('met_user_required');
  if (uid === metUserId) throw new Error('distinct_users_required');
  const coords = normalizeCoords(lat, lng);
  const checkin = {
    id: crypto.randomUUID(),
    uid,
    met_user_id: metUserId,
    meetup_id: meetupId || null,
    lat: coords.lat,
    lng: coords.lng,
    status: 'pending',
    check_at: normalizeCheckAt(checkAt),
    responded_at: null,
    alerted_at: null,
    created_at: nowIso(),
  };
  await writeCheckin(checkin);
  return checkin;
}

export async function listMySafetyCheckins(uid) {
  if (!uid) return [];
  const db = await getFirestore();
  if (!db) {
    return Array.from(memCheckins.values())
      .filter((checkin) => checkin.uid === uid)
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }
  const snap = await db.collection('khuloh_safety_checkins')
    .where('uid', '==', uid)
    .limit(100)
    .get();
  return snap.docs
    .map((doc) => doc.data())
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

export async function markSafetyCheckinSafe({ checkinId, uid }) {
  const checkin = await readCheckin(checkinId);
  if (!checkin) throw new Error('checkin_not_found');
  if (checkin.uid !== uid) throw new Error('forbidden');
  if (checkin.status !== 'pending') throw new Error('not_pending');
  checkin.status = 'safe';
  checkin.responded_at = nowIso();
  await writeCheckin(checkin);
  return checkin;
}

export async function processDueSafetyCheckins({ limit = 25 } = {}) {
  const cap = Math.min(Math.max(1, Number(limit) || 25), 100);
  const dueAt = Date.now();
  const db = await getFirestore();
  let due = [];

  if (!db) {
    due = Array.from(memCheckins.values())
      .filter((checkin) => checkin.status === 'pending' && Date.parse(checkin.check_at) <= dueAt)
      .sort((a, b) => (a.check_at || '').localeCompare(b.check_at || ''))
      .slice(0, cap);
  } else {
    const snap = await db.collection('khuloh_safety_checkins')
      .where('status', '==', 'pending')
      .limit(cap)
      .get();
    due = snap.docs
      .map((doc) => doc.data())
      .filter((checkin) => Date.parse(checkin.check_at) <= dueAt)
      .sort((a, b) => (a.check_at || '').localeCompare(b.check_at || ''));
  }

  let processed = 0;
  for (const checkin of due) {
    await triggerPanic({
      uid: checkin.uid,
      userLabel: checkin.uid,
      source: 'safety_checkin',
      meetupId: checkin.meetup_id || null,
      note: `Overdue safety check-in with ${checkin.met_user_id}`,
    });
    checkin.status = 'alerted';
    checkin.alerted_at = nowIso();
    await writeCheckin(checkin);
    processed += 1;
  }
  return { processed };
}

export function _resetSafetyCheckins() {
  memCheckins.clear();
}

export function attachSafetyCheckinRoutes(app, requireAuth) {
  app.get('/api/khuloh/safety-checkins', requireAuth, async (req, res) => {
    try {
      await processDueSafetyCheckins();
      const checkins = await listMySafetyCheckins(req.user.id);
      res.json({ checkins });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/khuloh/safety-checkins', requireAuth, async (req, res) => {
    try {
      const checkin = await createSafetyCheckin({
        uid: req.user.id,
        metUserId: req.body?.metUserId,
        checkAt: req.body?.checkAt,
        lat: req.body?.lat,
        lng: req.body?.lng,
        meetupId: req.body?.meetupId,
      });
      res.json({ checkin });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/khuloh/safety-checkins/:id/safe', requireAuth, async (req, res) => {
    try {
      const checkin = await markSafetyCheckinSafe({ checkinId: req.params.id, uid: req.user.id });
      res.json({ checkin });
    } catch (err) {
      const status = err.message === 'checkin_not_found' ? 404 : err.message === 'forbidden' ? 403 : 400;
      res.status(status).json({ error: err.message });
    }
  });
}