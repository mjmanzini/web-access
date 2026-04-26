/**
 * users.js — user directory backed by Postgres.
 *
 * Usernames are unique. Auth is token-based (issued at register, stored in
 * localStorage on the client). Presence is kept in-memory per-process — fine
 * for a single signaling node; move to Redis when you scale horizontally.
 */
import crypto from 'node:crypto';
import { pool, logEvent } from './db.js';

function randomId(bytes = 6) { return crypto.randomBytes(bytes).toString('hex'); }
function randomToken() { return crypto.randomBytes(32).toString('base64url'); }
function normalizeUsername(u) {
  return String(u || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
}

export class UserRegistry {
  constructor() {
    /** @type {Map<string, Set<string>>} userId -> Set<socketId> */
    this.presence = new Map();
  }

  async register({ username, displayName }) {
    const uname = normalizeUsername(username);
    if (!uname || uname.length < 2) throw new Error('invalid_username');
    const display = String(displayName || uname).trim().slice(0, 40) || uname;
    const id = randomId();
    const token = randomToken();
    try {
      await pool.query(
        `INSERT INTO users (id, username, display_name, token) VALUES ($1, $2, $3, $4)`,
        [id, uname, display, token],
      );
    } catch (e) {
      if (String(e.code) === '23505') throw new Error('username_taken');
      throw e;
    }
    logEvent('user_registered', { userId: id, payload: { username: uname } });
    return { id, username: uname, displayName: display, token };
  }

  async loginByToken(token) {
    if (!token) return null;
    const { rows } = await pool.query(
      `SELECT id, username, display_name AS "displayName" FROM users WHERE token = $1`,
      [token],
    );
    return rows[0] || null;
  }

  async getById(id) {
    if (!id) return null;
    const { rows } = await pool.query(
      `SELECT id, username, display_name AS "displayName" FROM users WHERE id = $1`,
      [id],
    );
    return rows[0] || null;
  }

  async publicList() {
    const { rows } = await pool.query(
      `SELECT id, username, display_name AS "displayName" FROM users ORDER BY display_name ASC`,
    );
    return rows.map((u) => ({
      ...u,
      online: (this.presence.get(u.id)?.size || 0) > 0,
    }));
  }

  attachSocket(userId, socketId) {
    let set = this.presence.get(userId);
    const wasOffline = !set || set.size === 0;
    if (!set) { set = new Set(); this.presence.set(userId, set); }
    set.add(socketId);
    return wasOffline;
  }
  detachSocket(userId, socketId) {
    const set = this.presence.get(userId);
    if (!set) return false;
    set.delete(socketId);
    if (set.size === 0) { this.presence.delete(userId); return true; }
    return false;
  }
  socketsOf(userId) { return [...(this.presence.get(userId) || [])]; }
}

// ---------------------------------------------------------------------------
// HTTP + Socket.IO wiring
// ---------------------------------------------------------------------------

/** @param {import('express').Express} app @param {UserRegistry} users */
export function attachUserRoutes(app, users) {
  app.post('/users/register', async (req, res) => {
    const { username, displayName } = req.body || {};
    try {
      const u = await users.register({ username, displayName });
      res.json(u);
    } catch (e) {
      const msg = e.message || 'invalid';
      res.status(msg === 'username_taken' ? 409 : 400).json({ error: msg });
    }
  });

  app.post('/users/login', async (req, res) => {
    const { token } = req.body || {};
    const u = await users.loginByToken(token);
    if (!u) return res.status(401).json({ error: 'invalid_token' });
    res.json(u);
  });

  app.get('/users', async (_req, res) => {
    try {
      res.json({ users: await users.publicList() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

/** @param {import('socket.io').Server} io @param {UserRegistry} users */
export function attachUserSignaling(io, users) {
  io.on('connection', (socket) => {
    /** @type {string|null} */
    let authedUserId = null;

    socket.on('user:hello', async ({ token } = {}, ack) => {
      const u = await users.loginByToken(token).catch(() => null);
      if (!u) { ack?.({ ok: false, error: 'invalid_token' }); return; }
      authedUserId = u.id;
      socket.join(`user:${u.id}`);
      const firstSocket = users.attachSocket(u.id, socket.id);
      ack?.({ ok: true, user: u });
      if (firstSocket) io.emit('user:presence', { userId: u.id, online: true });
      logEvent('user_online', { userId: u.id });
    });

    socket.on('user:call', async ({ toUserId, roomId } = {}, ack) => {
      if (!authedUserId) { ack?.({ ok: false, error: 'not_authed' }); return; }
      const me = await users.getById(authedUserId);
      const target = await users.getById(toUserId);
      if (!me || !target) { ack?.({ ok: false, error: 'unknown_user' }); return; }
      const sockets = users.socketsOf(target.id);
      if (sockets.length === 0) { ack?.({ ok: false, error: 'user_offline' }); return; }
      const assignedRoom = String(roomId || '').trim() || `dm-${me.id}-${target.id}-${Date.now().toString(36)}`;
      io.to(`user:${target.id}`).emit('user:incoming-call', {
        roomId: assignedRoom,
        from: me,
      });
      logEvent('call_ring', { roomId: assignedRoom, userId: me.id, payload: { toUserId: target.id } });
      ack?.({ ok: true, roomId: assignedRoom });
    });

    socket.on('user:call-response', ({ toUserId, roomId, accepted } = {}) => {
      if (!authedUserId || !toUserId) return;
      io.to(`user:${toUserId}`).emit('user:call-answered', {
        fromUserId: authedUserId,
        roomId,
        accepted: !!accepted,
      });
      logEvent(accepted ? 'call_accepted' : 'call_declined', {
        roomId, userId: authedUserId, payload: { toUserId },
      });
    });

    socket.on('user:call-cancel', ({ toUserId, roomId } = {}) => {
      if (!authedUserId || !toUserId) return;
      io.to(`user:${toUserId}`).emit('user:call-cancelled', {
        fromUserId: authedUserId,
        roomId,
      });
      logEvent('call_cancelled', { roomId, userId: authedUserId, payload: { toUserId } });
    });

    socket.on('disconnect', () => {
      if (!authedUserId) return;
      const wentOffline = users.detachSocket(authedUserId, socket.id);
      if (wentOffline) {
        io.emit('user:presence', { userId: authedUserId, online: false });
        logEvent('user_offline', { userId: authedUserId });
      }
    });
  });
}
