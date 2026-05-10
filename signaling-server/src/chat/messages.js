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
import crypto from 'node:crypto';
import { logEvent } from '../db.js';
import { socketAuth } from '../auth/sessions.js';
import { sendContactInviteEmail } from '../email/mailer.js';
import { createStorage } from '../storage/index.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function uid() {
  return crypto.randomBytes(8).toString('hex');
}

async function findOrCreate1to1(storage, meId, peerId) {
  if (meId === peerId) throw new Error('cannot_chat_with_self');
  return storage.chat.findOrCreateOneToOneConversation({
    conversationId: uid(),
    meId,
    peerId,
  });
}

async function listConversations(storage, userId) {
  return storage.chat.listConversations(userId);
}

async function listMessages(storage, conversationId, userId, { before, limit = 50 } = {}) {
  return storage.chat.listMessages({ conversationId, userId, before, limit });
}

async function persistMessage(storage, { conversationId, senderId, body, clientId }) {
  const text = String(body || '').slice(0, 8000);
  if (!text.trim()) throw new Error('empty_body');

  return storage.chat.persistMessage({
    messageId: uid(),
    conversationId,
    senderId,
    body: text,
    clientId,
  });
}

async function membersOf(storage, conversationId) {
  return storage.chat.listConversationMemberIds(conversationId);
}

async function markDelivered(storage, messageId, userId) {
  await storage.chat.markDelivered({ messageId, userId });
}

async function markRead(storage, messageId, userId) {
  await storage.chat.markRead({ messageId, userId });
}

function normalizeInviteEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeInviteName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function buildInviteUrl({ displayName, email, inviterName }) {
  const base = process.env.CLIENT_URL || process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000';
  const url = new URL('/onboarding', base);
  url.searchParams.set('name', displayName);
  url.searchParams.set('contact', email);
  url.searchParams.set('invitedBy', inviterName);
  return url.toString();
}

export function attachChatRoutes(app, requireAuth, storage = createStorage()) {
  app.get('/api/conversations', requireAuth, async (req, res) => {
    try {
      res.json({ conversations: await listConversations(storage, req.user.id) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/conversations', requireAuth, async (req, res) => {
    const { peerUserId } = req.body || {};
    if (!peerUserId) return res.status(400).json({ error: 'peerUserId_required' });
    try {
      const id = await findOrCreate1to1(storage, req.user.id, peerUserId);
      await storage.users.markKnownContact?.({ userId: req.user.id, contactUserId: peerUserId, reason: 'chat' }).catch(() => {});
      res.json({ id });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/contacts', requireAuth, async (req, res) => {
    try {
      const [knownContacts, conversations] = await Promise.all([
        storage.users.listKnownContacts?.(req.user.id).catch(() => []) || [],
        listConversations(storage, req.user.id).catch(() => []),
      ]);
      const byId = new Map();
      for (const contact of knownContacts) byId.set(contact.id, contact);
      for (const conversation of conversations) {
        for (const member of conversation.members || []) {
          if (member?.id && member.id !== req.user.id && !byId.has(member.id)) {
            byId.set(member.id, { ...member, reason: 'chat', lastContactAt: conversation.last_msg_at });
          }
        }
      }
      res.json({ contacts: [...byId.values()] });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/contacts/invite', requireAuth, async (req, res) => {
    const displayName = normalizeInviteName(req.body?.displayName);
    const email = normalizeInviteEmail(req.body?.email);
    if (displayName.length < 2) return res.status(400).json({ error: 'invalid_display_name' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email' });

    try {
      const existing = await storage.auth.findUserByEmail(email).catch(() => null);
      if (existing?.id === req.user.id) {
        return res.status(400).json({ error: 'cannot_add_self' });
      }
      if (existing) {
        await storage.users.markKnownContact?.({
          userId: req.user.id,
          contactUserId: existing.id,
          reason: 'invite',
        }).catch(() => {});
        const conversationId = await findOrCreate1to1(storage, req.user.id, existing.id);
        return res.json({
          mode: 'existing',
          contact: existing,
          conversationId,
        });
      }

      const inviteUrl = buildInviteUrl({
        displayName,
        email,
        inviterName: req.user.displayName || req.user.username || 'A contact',
      });
      await sendContactInviteEmail({
        to: email,
        inviteeName: displayName,
        inviterName: req.user.displayName || req.user.username || 'A contact',
        inviteUrl,
      });
      res.json({ mode: 'email', email });
    } catch (e) {
      const code = e.message === 'smtp_not_configured' ? 503 : 500;
      res.status(code).json({ error: e.message || 'invite_failed' });
    }
  });

  app.get('/api/conversations/:id/messages', requireAuth, async (req, res) => {
    try {
      const { before, limit } = req.query;
      const messages = await listMessages(storage, req.params.id, req.user.id, { before, limit });
      res.json({ messages });
    } catch (e) {
      const status = e.message === 'forbidden' ? 403 : 500;
      res.status(status).json({ error: e.message });
    }
  });
}

export function attachChatSignaling(io, users, storage = createStorage()) {
  const nsp = io.of('/chat');
  nsp.use(socketAuth(users));

  nsp.on('connection', (socket) => {
    const me = socket.data.user;
    users.attachSocket(me.id, socket.id);
    socket.join(`user:${me.id}`);
    logEvent('chat_connected', { userId: me.id });

    socket.on('disconnect', () => {
      users.detachSocket(me.id, socket.id);
    });

    socket.on('send', async ({ conversationId, body, clientId } = {}, ack) => {
      try {
        const msg = await persistMessage(storage, { conversationId, senderId: me.id, body, clientId });
        const recipients = (await membersOf(storage, conversationId)).filter((userId) => userId !== me.id);

        ack?.({ ok: true, message: msg });
        nsp.to(`user:${me.id}`).emit('message', msg);

        for (const userId of recipients) {
          nsp.to(`user:${userId}`).emit('message', msg);
          markDelivered(storage, msg.id, userId).catch(() => {});
          nsp.to(`user:${me.id}`).emit('receipt', {
            messageId: msg.id,
            userId,
            kind: 'delivered',
          });
        }
      } catch (e) {
        ack?.({ ok: false, error: e.message });
      }
    });

    socket.on('typing', async ({ conversationId, typing } = {}) => {
      try {
        const recipients = (await membersOf(storage, conversationId)).filter((userId) => userId !== me.id);
        for (const userId of recipients) {
          nsp.to(`user:${userId}`).emit('typing', {
            conversationId,
            userId: me.id,
            typing: !!typing,
          });
        }
      } catch {
        // ignore typing failures
      }
    });

    socket.on('read', async ({ conversationId, messageId } = {}) => {
      if (!conversationId || !messageId) return;
      try {
        await markRead(storage, messageId, me.id);
        await storage.chat.touchConversationRead({ conversationId, userId: me.id });
        const recipients = (await membersOf(storage, conversationId)).filter((userId) => userId !== me.id);
        for (const userId of recipients) {
          nsp.to(`user:${userId}`).emit('receipt', {
            messageId,
            userId: me.id,
            kind: 'read',
          });
        }
      } catch {
        // ignore read receipt failures
      }
    });
  });
}
