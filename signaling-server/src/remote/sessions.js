/**
 * remote/sessions.js — TeamViewer-style remote-desktop session manager.
 *
 * Concept:
 *   Every authenticated host has a stable 9-digit `remote_id` and (when ready
 *   to accept) a freshly generated short-lived 6-digit PIN. A viewer enters
 *   the partner's remote_id + PIN; on success, we mint a `sessionId` that
 *   bridges into the existing PairingRegistry so both peers share the same
 *   WebRTC signaling room used by the legacy host/client flow.
 *
 * REST  (all require auth except `connect` which validates by PIN):
 *   POST /api/remote/announce   { ttlSeconds? }    -> { remoteId, pin, expiresAt }
 *   POST /api/remote/cancel                         -> { ok }
 *   POST /api/remote/connect    { partnerId, pin }  -> { sessionId }
 *   GET  /api/remote/status                         -> { ready, pinExpiresAt }
 *
 * Storage: new `remote_announcements` table (PIN hash + expiry + viewer log).
 */
import crypto from 'node:crypto';
import { logEvent } from '../db.js';
import { createStorage } from '../storage/index.js';

export const REMOTE_SCHEMA_SQL = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS remote_id TEXT UNIQUE;

CREATE TABLE IF NOT EXISTS remote_announcements (
  host_user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pin_hash        BYTEA NOT NULL,
  pin_salt        BYTEA NOT NULL,
  pin_attempts    INT NOT NULL DEFAULT 0,
  expires_at      TIMESTAMPTZ NOT NULL,
  session_id      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS remote_sessions_log (
  id              BIGSERIAL PRIMARY KEY,
  session_id      TEXT NOT NULL,
  host_user_id    TEXT NOT NULL,
  viewer_user_id  TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  end_reason      TEXT
);
CREATE INDEX IF NOT EXISTS rs_log_host_idx ON remote_sessions_log(host_user_id, started_at DESC);
`;

const PIN_LENGTH = 6;
const PIN_DEFAULT_TTL = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function generateRemoteId() {
  // 9-digit numeric, no leading zero
  let s = '';
  do {
    s = String(crypto.randomInt(0, 1_000_000_000)).padStart(9, '0');
  } while (s.startsWith('0'));
  return s;
}
function generatePin() {
  return String(crypto.randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, '0');
}
function hashPin(pin, salt) {
  return crypto.scryptSync(pin, salt, 32);
}
function timingSafeEqual(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function ensureRemoteId(storage, userId) {
  const existingRemoteId = await storage.remote.findRemoteIdByUserId(userId);
  if (existingRemoteId) return existingRemoteId;
  for (let i = 0; i < 5; i++) {
    const candidate = generateRemoteId();
    try {
      await storage.remote.assignRemoteId(userId, candidate);
      return candidate;
    } catch (e) {
      if (String(e.code) !== '23505') throw e;
    }
  }
  throw new Error('remote_id_generation_failed');
}

async function findHostByRemoteId(storage, remoteId) {
  return storage.remote.findHostByRemoteId(remoteId);
}

export function attachRemoteRoutes(app, pairing, users, requireAuth, storage = createStorage()) {
  // Announce: host generates PIN + creates a pairing session bound to it.
  app.post('/api/remote/announce', requireAuth, async (req, res) => {
    const ttlMs = Math.min(
      Math.max(Number(req.body?.ttlSeconds || 0) * 1000 || PIN_DEFAULT_TTL, 60_000),
      30 * 60_000,
    );
    try {
      const remoteId = await ensureRemoteId(storage, req.user.id);
      const pin = generatePin();
      const salt = crypto.randomBytes(16);
      const hash = hashPin(pin, salt);
      const expiresAt = new Date(Date.now() + ttlMs);

      // Reuse the existing PairingRegistry so the WebRTC signaling room is shared.
      const { sessionId } = pairing.create();

      await storage.remote.saveAnnouncement({
        hostUserId: req.user.id,
        pinHash: hash,
        pinSalt: salt,
        expiresAt,
        sessionId,
      });
      logEvent('remote_announce', { userId: req.user.id, payload: { sessionId } });
      res.json({ remoteId, pin, sessionId, expiresAt: expiresAt.toISOString() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/remote/cancel', requireAuth, async (req, res) => {
    await storage.remote.cancelAnnouncement(req.user.id);
    logEvent('remote_cancel', { userId: req.user.id });
    res.json({ ok: true });
  });

  app.get('/api/remote/status', requireAuth, async (req, res) => {
    const announcement = await storage.remote.getAnnouncementStatus(req.user.id);
    if (!announcement) return res.json({ ready: false });
    const exp = new Date(announcement.expires_at);
    res.json({
      ready: exp.getTime() > Date.now(),
      pinExpiresAt: exp.toISOString(),
      sessionId: announcement.session_id,
    });
  });

  // Connect: viewer presents partner remote_id + PIN; we verify and return a sessionId.
  app.post('/api/remote/connect', requireAuth, async (req, res) => {
    const { partnerId, pin } = req.body || {};
    if (!partnerId || !pin) return res.status(400).json({ error: 'partner_and_pin_required' });
    if (!/^\d{6}$/.test(String(pin))) return res.status(400).json({ error: 'invalid_pin_format' });

    const host = await findHostByRemoteId(storage, String(partnerId).replace(/\s+/g, ''));
    if (!host) return res.status(404).json({ error: 'unknown_partner' });
    if (host.id === req.user.id) return res.status(400).json({ error: 'cannot_connect_self' });

    try {
      const result = await storage.remote.connectWithPin({
        hostUserId: host.id,
        viewerUserId: req.user.id,
        pin,
        hashPin,
        timingSafeEqual,
        maxAttempts: MAX_ATTEMPTS,
      });

      if (result.outcome === 'host_not_announcing') {
        return res.status(404).json({ error: 'host_not_announcing' });
      }
      if (result.outcome === 'pin_expired') {
        return res.status(410).json({ error: 'pin_expired' });
      }
      if (result.outcome === 'too_many_attempts') {
        logEvent('remote_pin_lockout', { userId: host.id });
        return res.status(429).json({ error: 'too_many_attempts' });
      }
      if (result.outcome === 'bad_pin') {
        logEvent('remote_pin_bad', { userId: host.id, payload: { viewerId: req.user.id } });
        return res.status(401).json({ error: 'bad_pin' });
      }

      logEvent('remote_pin_ok', {
        userId: req.user.id, payload: { hostId: host.id, sessionId: result.sessionId },
      });
      res.json({
        sessionId: result.sessionId,
        host: { id: host.id, displayName: host.displayName },
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
