/**
 * khuloh/zones.js — live group "Zones" (Mxit-style chat rooms).
 *
 * Phase 5/6 deliverable. Zones are public, ephemeral group chats keyed by
 * city + topic. Messages are NOT end-to-end encrypted (multi-recipient,
 * scam-shield must inspect them) but ARE retained for only 24h to keep
 * the surface tight.
 *
 * Storage: Firestore collections `khuloh_zones` and
 * `khuloh_zone_messages`. Falls back to an in-memory store when Firebase
 * isn't configured (local dev).
 *
 * REST:
 *   GET  /api/khuloh/zones?city=        list active zones (city optional)
 *   POST /api/khuloh/zones              { city, name, topic? }   create
 *   GET  /api/khuloh/zones/:id/messages?limit=
 *
 * Socket.IO `/khuloh`:
 *   client -> 'zone:join'   { zoneId }
 *   client -> 'zone:leave'  { zoneId }
 *   client -> 'zone:msg'    { zoneId, body }     ack: { ok, message? }
 *   server -> 'zone:msg'    { id, zoneId, fromId, fromHandle, body, ts }
 */
import crypto from 'node:crypto';
import { evaluateMessage as scamShieldEvaluate, buildBlockNotice } from './scam-shield.js';
import { isMutedInZone } from './moderation.js';
import { encodeZoneMessage } from './wire.js';
import { logEvent } from '../db.js';

let firestoreLoaderPromise;

async function getFirestore() {
  if (!firestoreLoaderPromise) {
    firestoreLoaderPromise = (async () => {
      if (!process.env.FIREBASE_PROJECT_ID && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        return null;
      }
      try {
        const [{ getApps, getApp, initializeApp, applicationDefault }, { getFirestore }] = await Promise.all([
          import('firebase-admin/app'),
          import('firebase-admin/firestore'),
        ]);
        const app = getApps().length
          ? getApp()
          : initializeApp({
              projectId: process.env.FIREBASE_PROJECT_ID,
              credential: applicationDefault?.(),
            });
        return getFirestore(app);
      } catch (err) {
        console.warn('[khuloh/zones] firestore init failed; using memory:', err.message);
        return null;
      }
    })();
  }
  return firestoreLoaderPromise;
}

// --- in-memory fallback (dev only) ---
const memZones = new Map();        // id -> { id, name, city, topic, ... }
const memMessages = new Map();     // zoneId -> [msg]

function nowIso() { return new Date().toISOString(); }

function normCity(value) {
  return String(value || '').trim().slice(0, 64);
}

function normName(value) {
  return String(value || '').trim().slice(0, 80);
}

export async function listZones({ city } = {}) {
  const db = await getFirestore();
  if (!db) {
    const all = Array.from(memZones.values());
    return city ? all.filter((z) => z.city === city) : all;
  }
  let q = db.collection('khuloh_zones');
  if (city) q = q.where('city', '==', city);
  const snap = await q.limit(50).get();
  return snap.docs.map((d) => d.data());
}

export async function createZone({ name, city, topic = null, createdBy }) {
  const cleanName = normName(name);
  const cleanCity = normCity(city);
  if (!cleanName) throw new Error('name_required');
  if (!cleanCity) throw new Error('city_required');

  const zone = {
    id: crypto.randomUUID(),
    name: cleanName,
    city: cleanCity,
    topic: topic ? String(topic).slice(0, 200) : null,
    createdBy: createdBy || null,
    member_count: 0,
    is_official: false,
    created_at: nowIso(),
  };

  const db = await getFirestore();
  if (!db) {
    memZones.set(zone.id, zone);
    return zone;
  }
  await db.collection('khuloh_zones').doc(zone.id).set(zone);
  return zone;
}

export async function getZone(id) {
  const db = await getFirestore();
  if (!db) return memZones.get(id) || null;
  const snap = await db.collection('khuloh_zones').doc(id).get();
  return snap.exists ? snap.data() : null;
}

export async function persistZoneMessage({ zoneId, fromId, fromHandle, body }) {
  const msg = {
    id: crypto.randomUUID(),
    zoneId,
    fromId,
    fromHandle: fromHandle || null,
    body,
    ts: nowIso(),
  };
  const db = await getFirestore();
  if (!db) {
    const arr = memMessages.get(zoneId) || [];
    arr.push(msg);
    if (arr.length > 200) arr.splice(0, arr.length - 200);
    memMessages.set(zoneId, arr);
    return msg;
  }
  await db.collection('khuloh_zone_messages').doc(msg.id).set(msg);
  return msg;
}

export async function listZoneMessages(zoneId, { limit = 50 } = {}) {
  const cap = Math.min(Math.max(1, Number(limit) | 0 || 50), 200);
  const db = await getFirestore();
  if (!db) {
    const arr = memMessages.get(zoneId) || [];
    return arr.slice(-cap);
  }
  const snap = await db
    .collection('khuloh_zone_messages')
    .where('zoneId', '==', zoneId)
    .orderBy('ts', 'desc')
    .limit(cap)
    .get();
  return snap.docs.map((d) => d.data()).reverse();
}

// --------- HTTP routes ---------

export function attachZoneRoutes(app, requireAuth) {
  app.get('/api/khuloh/zones', async (req, res) => {
    try {
      const zones = await listZones({ city: req.query.city ? String(req.query.city) : undefined });
      res.json({ zones });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/khuloh/zones', requireAuth, async (req, res) => {
    try {
      const zone = await createZone({
        name: req.body?.name,
        city: req.body?.city,
        topic: req.body?.topic,
        createdBy: req.user.id,
      });
      res.json({ zone });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/khuloh/zones/:id/messages', requireAuth, async (req, res) => {
    try {
      const messages = await listZoneMessages(req.params.id, { limit: req.query.limit });
      res.json({ messages });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

// --------- Socket handlers (called from khuloh/socket.js) ---------

export function registerZoneSocket(nsp, socket, me) {
  socket.on('zone:msg', async ({ zoneId, body } = {}, ack) => {
    try {
      if (!zoneId || typeof zoneId !== 'string') throw new Error('zone_required');
      const text = String(body || '').trim().slice(0, 1000);
      if (!text) throw new Error('body_required');

      if (await isMutedInZone(zoneId, me.id)) {
        ack?.({ ok: false, error: 'muted', notice: 'A Guardian has muted you in this Zone.' });
        return;
      }

      const verdict = scamShieldEvaluate(text);
      if (verdict.action === 'block') {
        logEvent('khuloh_scam_blocked', { userId: me.id, zoneId, reasons: verdict.reasons, kind: 'zone_msg' });
        ack?.({ ok: false, error: 'scam_blocked', notice: buildBlockNotice() });
        return;
      }
      if (verdict.action === 'flag') {
        logEvent('khuloh_scam_flagged', { userId: me.id, zoneId, reasons: verdict.reasons, kind: 'zone_msg' });
      }

      const msg = await persistZoneMessage({
        zoneId,
        fromId: me.id,
        fromHandle: me.username || me.displayName || null,
        body: text,
      });
      nsp.to(`zone:${zoneId}`).emit('zone:msg', msg);
      // Phase 8 data-lite mirror.
      nsp.to(`zone:${zoneId}`).emit('zone:msg.b', encodeZoneMessage(msg));
      ack?.({ ok: true, message: msg });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });
}
