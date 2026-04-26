/**
 * chat/messages.js — durable 1:1 chat with WhatsApp-style receipts.
 *
 * Schema (additive, owns its own tables to avoid colliding with the legacy
 * `chat_messages` that's tied to call rooms):
 *   conversations        (id, is_group, title, created_at)
 *   conversation_members (conversation_id, user_id, last_read_at)
 *   chat_messages_v2     (id, conversation_id, sender_id, body, created_at, ...)
 *   message_receipts     (message_id, user_id, delivered_at, read_at)
 *
 * REST:
 *   GET  /api/conversations                    list my conversations
 *   POST /api/conversations  { peerUserId }    open / fetch a 1:1 conversation
 *   GET  /api/conversations/:id/messages?before=&limit=
 *
 * Socket.IO `/chat` namespace (auth required via socketAuth):
 *   client -> 'send'    { conversationId, body, clientId }   (ack with persisted msg)
 *   client -> 'typing'  { conversationId, typing }
 *   client -> 'read'    { conversationId, messageId }
 *   server -> 'message' { ...persisted message }
 *   server -> 'receipt' { messageId, userId, kind }
 *   server -> 'typing'  { conversationId, userId, typing }
 */
import { pool, logEvent } from '../db.js';
import { socketAuth } from '../auth/sessions.js';

export const CHAT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,
  is_group      BOOLEAN NOT NULL DEFAULT false,
  title         TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_msg_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at    TIMESTAMPTZ,
  role            TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conv_members_user_idx ON conversation_members(user_id);

CREATE TABLE IF NOT EXISTS chat_messages_v2 (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT,
  client_id       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at       TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS chat_v2_convo_time_idx ON chat_messages_v2(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS message_receipts (
  message_id    TEXT NOT NULL REFERENCES chat_messages_v2(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at  TIMESTAMPTZ,
  read_at       TIMESTAMPTZ,
  PRIMARY KEY (message_id, user_id)
);
`;

import crypto from 'node:crypto';
function uid() { return crypto.randomBytes(8).toString('hex'); }

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------
async function findOrCreate1to1(meId, peerId) {
  if (meId === peerId) throw new Error('cannot_chat_with_self');
  // Find existing 1:1
  const { rows } = await pool.query(
    `SELECT c.id FROM conversations c
       JOIN conversation_members m1 ON m1.conversation_id=c.id AND m1.user_id=$1
       JOIN conversation_members m2 ON m2.conversation_id=c.id AND m2.user_id=$2
      WHERE c.is_group = false
      LIMIT 1`,
    [meId, peerId],
  );
  if (rows[0]) return rows[0].id;
  // Create
  const id = uid();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO conversations (id, is_group, created_by) VALUES ($1, false, $2)`,
      [id, meId],
    );
    await client.query(
      `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2),($1,$3)`,
      [id, meId, peerId],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally {
    client.release();
  }
  return id;
}

async function listConversations(userId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.is_group, c.title, c.last_msg_at,
            (SELECT body  FROM chat_messages_v2 m
              WHERE m.conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_body,
            (SELECT json_agg(json_build_object('id', u.id, 'displayName', u.display_name))
               FROM conversation_members cm JOIN users u ON u.id=cm.user_id
              WHERE cm.conversation_id=c.id AND cm.user_id <> $1) AS members,
            COALESCE((SELECT COUNT(*) FROM chat_messages_v2 m
                       LEFT JOIN message_receipts r ON r.message_id=m.id AND r.user_id=$1
                      WHERE m.conversation_id=c.id AND m.sender_id <> $1
                        AND r.read_at IS NULL), 0) AS unread
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id=c.id
      WHERE cm.user_id = $1
      ORDER BY c.last_msg_at DESC NULLS LAST, c.created_at DESC`,
    [userId],
  );
  return rows;
}

async function listMessages(conversationId, userId, { before, limit = 50 } = {}) {
  // Authorization
  const { rows: mem } = await pool.query(
    `SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`,
    [conversationId, userId],
  );
  if (!mem[0]) throw new Error('forbidden');

  const params = [conversationId];
  let where = `conversation_id = $1 AND deleted_at IS NULL`;
  if (before) { params.push(before); where += ` AND created_at < $${params.length}`; }
  params.push(Math.min(Number(limit) || 50, 200));
  const { rows } = await pool.query(
    `SELECT id, conversation_id AS "conversationId", sender_id AS "senderId",
            body, client_id AS "clientId", created_at AS "createdAt"
       FROM chat_messages_v2
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows.reverse();
}

async function persistMessage({ conversationId, senderId, body, clientId }) {
  const id = uid();
  const text = String(body || '').slice(0, 8000);
  if (!text.trim()) throw new Error('empty_body');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Authorization
    const { rows: mem } = await client.query(
      `SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`,
      [conversationId, senderId],
    );
    if (!mem[0]) throw new Error('forbidden');

    const { rows } = await client.query(
      `INSERT INTO chat_messages_v2 (id, conversation_id, sender_id, body, client_id)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, conversation_id AS "conversationId", sender_id AS "senderId",
                 body, client_id AS "clientId", created_at AS "createdAt"`,
      [id, conversationId, senderId, text, clientId || null],
    );
    await client.query(
      `UPDATE conversations SET last_msg_at = now() WHERE id = $1`,
      [conversationId],
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally {
    client.release();
  }
}

async function membersOf(conversationId) {
  const { rows } = await pool.query(
    `SELECT user_id AS "userId" FROM conversation_members WHERE conversation_id=$1`,
    [conversationId],
  );
  return rows.map((r) => r.userId);
}

async function markDelivered(messageId, userId) {
  await pool.query(
    `INSERT INTO message_receipts (message_id, user_id, delivered_at)
     VALUES ($1, $2, now())
     ON CONFLICT (message_id, user_id) DO UPDATE
       SET delivered_at = COALESCE(message_receipts.delivered_at, EXCLUDED.delivered_at)`,
    [messageId, userId],
  );
}
async function markRead(messageId, userId) {
  await pool.query(
    `INSERT INTO message_receipts (message_id, user_id, delivered_at, read_at)
     VALUES ($1, $2, now(), now())
     ON CONFLICT (message_id, user_id) DO UPDATE
       SET delivered_at = COALESCE(message_receipts.delivered_at, EXCLUDED.delivered_at),
           read_at      = COALESCE(message_receipts.read_at, EXCLUDED.read_at)`,
    [messageId, userId],
  );
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------
export function attachChatRoutes(app, requireAuth) {
  app.get('/api/conversations', requireAuth, async (req, res) => {
    try { res.json({ conversations: await listConversations(req.user.id) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/conversations', requireAuth, async (req, res) => {
    const { peerUserId } = req.body || {};
    if (!peerUserId) return res.status(400).json({ error: 'peerUserId_required' });
    try {
      const id = await findOrCreate1to1(req.user.id, peerUserId);
      res.json({ id });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.get('/api/conversations/:id/messages', requireAuth, async (req, res) => {
    try {
      const { before, limit } = req.query;
      const msgs = await listMessages(req.params.id, req.user.id, { before, limit });
      res.json({ messages: msgs });
    } catch (e) {
      const status = e.message === 'forbidden' ? 403 : 500;
      res.status(status).json({ error: e.message });
    }
  });
}

// ---------------------------------------------------------------------------
// Socket.IO namespace
// ---------------------------------------------------------------------------
export function attachChatSignaling(io, users) {
  const nsp = io.of('/chat');
  nsp.use(socketAuth(users));

  nsp.on('connection', (socket) => {
    const me = socket.data.user;
    socket.join(`user:${me.id}`);
    logEvent('chat_connected', { userId: me.id });

    socket.on('send', async ({ conversationId, body, clientId } = {}, ack) => {
      try {
        const msg = await persistMessage({ conversationId, senderId: me.id, body, clientId });
        const recipients = (await membersOf(conversationId)).filter((u) => u !== me.id);

        // Echo to sender (so all of their devices update + ack)
        ack?.({ ok: true, message: msg });
        nsp.to(`user:${me.id}`).emit('message', msg);

        // Fan out to recipients; mark delivered when their socket actually receives
        for (const uid of recipients) {
          nsp.to(`user:${uid}`).emit('message', msg);
          // Optimistic delivered receipt — server-side as soon as fan-out happens
          markDelivered(msg.id, uid).catch(() => {});
          nsp.to(`user:${me.id}`).emit('receipt', {
            messageId: msg.id, userId: uid, kind: 'delivered',
          });
        }
      } catch (e) {
        ack?.({ ok: false, error: e.message });
      }
    });

    socket.on('typing', async ({ conversationId, typing } = {}) => {
      try {
        const recipients = (await membersOf(conversationId)).filter((u) => u !== me.id);
        for (const uid of recipients) {
          nsp.to(`user:${uid}`).emit('typing', {
            conversationId, userId: me.id, typing: !!typing,
          });
        }
      } catch { /* ignore */ }
    });

    socket.on('read', async ({ conversationId, messageId } = {}) => {
      if (!conversationId || !messageId) return;
      try {
        await markRead(messageId, me.id);
        await pool.query(
          `UPDATE conversation_members SET last_read_at = now()
            WHERE conversation_id=$1 AND user_id=$2`,
          [conversationId, me.id],
        );
        const recipients = (await membersOf(conversationId)).filter((u) => u !== me.id);
        for (const uid of recipients) {
          nsp.to(`user:${uid}`).emit('receipt', {
            messageId, userId: me.id, kind: 'read',
          });
        }
      } catch { /* ignore */ }
    });
  });
}
