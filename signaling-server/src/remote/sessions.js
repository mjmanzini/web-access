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
import { pool, logEvent } from '../db.js';

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

async function ensureRemoteId(userId) {
  const { rows } = await pool.query(`SELECT remote_id FROM users WHERE id=$1`, [userId]);
  if (rows[0]?.remote_id) return rows[0].remote_id;
  for (let i = 0; i < 5; i++) {
    const candidate = generateRemoteId();
    try {
      await pool.query(`UPDATE users SET remote_id=$1 WHERE id=$2`, [candidate, userId]);
      return candidate;
    } catch (e) {
      if (String(e.code) !== '23505') throw e;
    }
  }
  throw new Error('remote_id_generation_failed');
}

async function findHostByRemoteId(remoteId) {
  const { rows } = await pool.query(
    `SELECT id, display_name AS "displayName" FROM users WHERE remote_id=$1`,
    [remoteId],
  );
  return rows[0] || null;
}

export function attachRemoteRoutes(app, pairing, users, requireAuth) {
  // Announce: host generates PIN + creates a pairing session bound to it.
  app.post('/api/remote/announce', requireAuth, async (req, res) => {
    const ttlMs = Math.min(
      Math.max(Number(req.body?.ttlSeconds || 0) * 1000 || PIN_DEFAULT_TTL, 60_000),
      30 * 60_000,
    );
    try {
      const remoteId = await ensureRemoteId(req.user.id);
      const pin = generatePin();
      const salt = crypto.randomBytes(16);
      const hash = hashPin(pin, salt);
      const expiresAt = new Date(Date.now() + ttlMs);

      // Reuse the existing PairingRegistry so the WebRTC signaling room is shared.
      const { sessionId } = pairing.create();

      await pool.query(
        `INSERT INTO remote_announcements
           (host_user_id, pin_hash, pin_salt, pin_attempts, expires_at, session_id, updated_at)
         VALUES ($1,$2,$3,0,$4,$5, now())
         ON CONFLICT (host_user_id) DO UPDATE
            SET pin_hash=$2, pin_salt=$3, pin_attempts=0,
                expires_at=$4, session_id=$5, updated_at=now()`,
        [req.user.id, hash, salt, expiresAt, sessionId],
      );
      logEvent('remote_announce', { userId: req.user.id, payload: { sessionId } });
      res.json({ remoteId, pin, sessionId, expiresAt: expiresAt.toISOString() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/remote/cancel', requireAuth, async (req, res) => {
    await pool.query(`DELETE FROM remote_announcements WHERE host_user_id=$1`, [req.user.id]);
    logEvent('remote_cancel', { userId: req.user.id });
    res.json({ ok: true });
  });

  app.get('/api/remote/status', requireAuth, async (req, res) => {
    const { rows } = await pool.query(
      `SELECT expires_at, session_id FROM remote_announcements WHERE host_user_id=$1`,
      [req.user.id],
    );
    if (!rows[0]) return res.json({ ready: false });
    const exp = new Date(rows[0].expires_at);
    res.json({
      ready: exp.getTime() > Date.now(),
      pinExpiresAt: exp.toISOString(),
      sessionId: rows[0].session_id,
    });
  });

  // Connect: viewer presents partner remote_id + PIN; we verify and return a sessionId.
  app.post('/api/remote/connect', requireAuth, async (req, res) => {
    const { partnerId, pin } = req.body || {};
    if (!partnerId || !pin) return res.status(400).json({ error: 'partner_and_pin_required' });
    if (!/^\d{6}$/.test(String(pin))) return res.status(400).json({ error: 'invalid_pin_format' });

    const host = await findHostByRemoteId(String(partnerId).replace(/\s+/g, ''));
    if (!host) return res.status(404).json({ error: 'unknown_partner' });
    if (host.id === req.user.id) return res.status(400).json({ error: 'cannot_connect_self' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT pin_hash, pin_salt, pin_attempts, expires_at, session_id
           FROM remote_announcements
          WHERE host_user_id=$1 FOR UPDATE`,
        [host.id],
      );
      const ann = rows[0];
      if (!ann) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'host_not_announcing' }); }
      if (new Date(ann.expires_at).getTime() < Date.now()) {
        await client.query('DELETE FROM remote_announcements WHERE host_user_id=$1', [host.id]);
        await client.query('COMMIT');
        return res.status(410).json({ error: 'pin_expired' });
      }
      if (ann.pin_attempts >= MAX_ATTEMPTS) {
        await client.query('DELETE FROM remote_announcements WHERE host_user_id=$1', [host.id]);
        await client.query('COMMIT');
        logEvent('remote_pin_lockout', { userId: host.id });
        return res.status(429).json({ error: 'too_many_attempts' });
      }

      const submitted = hashPin(String(pin), ann.pin_salt);
      const ok = timingSafeEqual(submitted, ann.pin_hash);
      if (!ok) {
        await client.query(
          `UPDATE remote_announcements SET pin_attempts = pin_attempts + 1, updated_at=now()
            WHERE host_user_id=$1`,
          [host.id],
        );
        await client.query('COMMIT');
        logEvent('remote_pin_bad', { userId: host.id, payload: { viewerId: req.user.id } });
        return res.status(401).json({ error: 'bad_pin' });
      }

      // Single-use: clear the announcement so the same PIN can't be reused.
      await client.query(`DELETE FROM remote_announcements WHERE host_user_id=$1`, [host.id]);
      await client.query(
        `INSERT INTO remote_sessions_log (session_id, host_user_id, viewer_user_id)
         VALUES ($1,$2,$3)`,
        [ann.session_id, host.id, req.user.id],
      );
      await client.query('COMMIT');

      logEvent('remote_pin_ok', {
        userId: req.user.id, payload: { hostId: host.id, sessionId: ann.session_id },
      });
      res.json({
        sessionId: ann.session_id,
        host: { id: host.id, displayName: host.displayName },
      });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });
}
