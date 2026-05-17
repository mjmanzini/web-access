/**
 * khuloh/moderation.js — Mute-in-zone (Phase 6 Guardian moderation).
 *
 * Storage: Firestore `khuloh_zone_mutes` keyed by `${zoneId}:${targetUid}`.
 * Doc:    { zone_id, target_uid, by_uid, reason, expires_at, created_at }
 *
 * Falls back to an in-memory Map in dev. Mutes auto-expire on read.
 *
 * Caller must verify the actor is a Guardian (trust tier === 'guardian')
 * via `computeTrustScore` before invoking `muteInZone`.
 */
import { getFirestore } from './firestore.js';

const memMutes = new Map();
const MAX_DURATION_MIN = 60;

function nowIso() { return new Date().toISOString(); }
function key(zoneId, uid) { return `${zoneId}:${uid}`; }

function isExpired(mute) {
  if (!mute) return true;
  return new Date(mute.expires_at).getTime() <= Date.now();
}

export async function getMute(zoneId, targetUid) {
  const db = await getFirestore();
  if (!db) {
    const m = memMutes.get(key(zoneId, targetUid));
    if (m && !isExpired(m)) return m;
    if (m) memMutes.delete(key(zoneId, targetUid));
    return null;
  }
  const snap = await db.collection('khuloh_zone_mutes').doc(key(zoneId, targetUid)).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (isExpired(data)) {
    await snap.ref.delete().catch(() => {});
    return null;
  }
  return data;
}

export async function isMutedInZone(zoneId, uid) {
  return !!(await getMute(zoneId, uid));
}

export async function muteInZone({ zoneId, targetUid, byUid, minutes = 10, reason = null }) {
  if (!zoneId || !targetUid) throw new Error('zone_and_target_required');
  if (targetUid === byUid)  throw new Error('cannot_mute_self');
  const dur = Math.max(1, Math.min(MAX_DURATION_MIN, Number(minutes) || 10));
  const expiresAt = new Date(Date.now() + dur * 60_000).toISOString();
  const mute = {
    zone_id: zoneId,
    target_uid: targetUid,
    by_uid: byUid,
    reason: reason ? String(reason).slice(0, 200) : null,
    minutes: dur,
    expires_at: expiresAt,
    created_at: nowIso(),
  };
  const db = await getFirestore();
  if (!db) { memMutes.set(key(zoneId, targetUid), mute); return mute; }
  await db.collection('khuloh_zone_mutes').doc(key(zoneId, targetUid)).set(mute);
  return mute;
}

export async function unmuteInZone({ zoneId, targetUid }) {
  const db = await getFirestore();
  if (!db) { memMutes.delete(key(zoneId, targetUid)); return true; }
  await db.collection('khuloh_zone_mutes').doc(key(zoneId, targetUid)).delete().catch(() => {});
  return true;
}

export async function listZoneMutes(zoneId) {
  const db = await getFirestore();
  if (!db) {
    return Array.from(memMutes.values())
      .filter((m) => m.zone_id === zoneId && !isExpired(m));
  }
  const snap = await db.collection('khuloh_zone_mutes').where('zone_id', '==', zoneId).limit(100).get();
  return snap.docs.map((d) => d.data()).filter((m) => !isExpired(m));
}
