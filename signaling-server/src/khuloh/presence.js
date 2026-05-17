/**
 * khuloh/presence.js — in-memory Zone presence + typing.
 *
 * Lives entirely in process memory (one node per zone is fine for our
 * single-instance Cloud Run signaling). Presence is intentionally cheap:
 * no Firestore writes, just room broadcasts.
 *
 * Membership is keyed by `(zoneId, uid)` with a Set of sockets, so a user
 * with two tabs only counts once and only disappears when the last tab
 * closes.
 */

// zoneId -> Map<uid, { uid, handle, sockets:Set<socketId>, joinedAt }>
const zones = new Map();
// socketId -> Set<zoneId>  (reverse index for fast disconnect cleanup)
const sockets = new Map();

function ensureZone(zoneId) {
  let z = zones.get(zoneId);
  if (!z) { z = new Map(); zones.set(zoneId, z); }
  return z;
}

function trackSocketZone(socketId, zoneId) {
  let s = sockets.get(socketId);
  if (!s) { s = new Set(); sockets.set(socketId, s); }
  s.add(zoneId);
}

function untrackSocketZone(socketId, zoneId) {
  const s = sockets.get(socketId);
  if (!s) return;
  s.delete(zoneId);
  if (s.size === 0) sockets.delete(socketId);
}

export function addPresence({ zoneId, socketId, uid, handle }) {
  if (!zoneId || !uid || !socketId) return null;
  const z = ensureZone(zoneId);
  let member = z.get(uid);
  if (!member) {
    member = { uid, handle: handle || null, sockets: new Set(), joinedAt: Date.now() };
    z.set(uid, member);
  } else if (handle && !member.handle) {
    member.handle = handle;
  }
  const wasEmpty = member.sockets.size === 0;
  member.sockets.add(socketId);
  trackSocketZone(socketId, zoneId);
  // Only emit a change when this is a genuinely new user (first socket).
  return { changed: wasEmpty, member };
}

export function removePresence({ zoneId, socketId, uid }) {
  if (!zoneId) return null;
  const z = zones.get(zoneId);
  if (!z) return null;
  untrackSocketZone(socketId, zoneId);
  if (!uid) {
    // Best-effort: find which user owns this socket within the zone.
    for (const [k, v] of z) if (v.sockets.has(socketId)) { uid = k; break; }
    if (!uid) return null;
  }
  const member = z.get(uid);
  if (!member) return null;
  member.sockets.delete(socketId);
  if (member.sockets.size === 0) {
    z.delete(uid);
    if (z.size === 0) zones.delete(zoneId);
    return { changed: true, uid };
  }
  return { changed: false, uid };
}

export function removeSocket(socketId) {
  const zoneIds = sockets.get(socketId);
  if (!zoneIds) return [];
  const removed = [];
  for (const zoneId of Array.from(zoneIds)) {
    const r = removePresence({ zoneId, socketId });
    if (r?.changed) removed.push(zoneId);
  }
  return removed;
}

export function listPresence(zoneId) {
  const z = zones.get(zoneId);
  if (!z) return { zoneId, count: 0, members: [] };
  const members = Array.from(z.values()).map((m) => ({ uid: m.uid, handle: m.handle }));
  return { zoneId, count: members.length, members };
}

/** For tests only. */
export function _resetPresence() { zones.clear(); sockets.clear(); }
