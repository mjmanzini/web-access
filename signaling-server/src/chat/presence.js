/**
 * chat/presence.js — online / last-seen tracker.
 *
 * Reuses the existing UserRegistry presence map (in-memory, per-process).
 * This module only adds:
 *   - persistent `last_seen_at` updates in the users table (best-effort)
 *   - a `/api/presence?ids=a,b,c` lookup for the contact list
 *   - broadcast on the `/chat` namespace when status flips
 */
import { pool, logEvent } from '../db.js';

export async function ensureLastSeenColumn() {
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT`);
  } catch (e) {
    // non-fatal: legacy DBs without privileges will just skip the feature
    console.warn('[presence] ensure columns:', e.message);
  }
}

async function touchLastSeen(userId) {
  if (!userId) return;
  try {
    await pool.query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [userId]);
  } catch { /* ignore */ }
}

export function attachPresenceRoutes(app, users, requireAuth) {
  app.get('/api/presence', requireAuth, async (req, res) => {
    const idsParam = String(req.query.ids || '').trim();
    if (!idsParam) return res.json({ presence: {} });
    const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
    try {
      const { rows } = await pool.query(
        `SELECT id, last_seen_at AS "lastSeenAt" FROM users WHERE id = ANY($1::text[])`,
        [ids],
      );
      const out = {};
      for (const r of rows) {
        out[r.id] = {
          online: (users.socketsOf(r.id)?.length || 0) > 0,
          lastSeenAt: r.lastSeenAt,
        };
      }
      res.json({ presence: out });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

/**
 * Bridge presence transitions from the existing UserRegistry into the
 * `/chat` namespace so the contact list updates without a refresh.
 */
export function attachPresenceBroadcast(io, users) {
  // Wrap attachSocket / detachSocket to also broadcast presence on /chat.
  const origAttach = users.attachSocket.bind(users);
  const origDetach = users.detachSocket.bind(users);
  users.attachSocket = (userId, socketId) => {
    const wasOffline = origAttach(userId, socketId);
    if (wasOffline) {
      io.of('/chat').emit('presence', { userId, online: true });
      touchLastSeen(userId);
      logEvent('presence_online', { userId });
    }
    return wasOffline;
  };
  users.detachSocket = (userId, socketId) => {
    const wentOffline = origDetach(userId, socketId);
    if (wentOffline) {
      io.of('/chat').emit('presence', { userId, online: false });
      touchLastSeen(userId);
      logEvent('presence_offline', { userId });
    }
    return wentOffline;
  };
}
