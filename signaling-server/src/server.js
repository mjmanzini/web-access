import http from 'node:http';
import https from 'node:https';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { PairingRegistry } from './pairing.js';
import { attachSignaling } from './signaling.js';
import { attachCallSignaling } from './call-signaling.js';
import { UserRegistry, attachUserRoutes, attachUserSignaling } from './users.js';
import { buildIceServers } from './ice.js';
import { detectLanIp, loadOrCreateCert } from './https-boot.js';
import { initDb, registerExtraSchema } from './db.js';
import { authMiddleware, requireAuth } from './auth/sessions.js';
import { attachAuthRoutes } from './auth/register.js';
import {
  CHAT_SCHEMA_SQL, attachChatRoutes, attachChatSignaling,
} from './chat/messages.js';
import {
  ensureLastSeenColumn, attachPresenceRoutes, attachPresenceBroadcast,
} from './chat/presence.js';
import { REMOTE_SCHEMA_SQL, attachRemoteRoutes } from './remote/sessions.js';

const PORT = Number(process.env.PORT || 4000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const SHARED_SECRET = process.env.SIGNALING_SHARED_SECRET || '';
const USE_HTTPS = process.env.HTTPS === '1' || process.env.HTTPS === 'true';

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

const pairing = new PairingRegistry();
const users = new UserRegistry();

// Bearer-token auth on every HTTP request (populates req.user when valid).
app.use(authMiddleware(users));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, sessions: pairing.size() });
});

attachUserRoutes(app, users);
attachAuthRoutes(app, users);
attachChatRoutes(app, requireAuth);
attachPresenceRoutes(app, users, requireAuth);
attachRemoteRoutes(app, pairing, users, requireAuth);

// Register extra schema before initDb runs.
registerExtraSchema(CHAT_SCHEMA_SQL);
registerExtraSchema(REMOTE_SCHEMA_SQL);

// ICE servers (STUN + optionally TURN). Credentials are freshly minted per
// request when using TURN REST mode, so clients should call this at connect time.
app.get('/ice', (_req, res) => {
  res.json({ iceServers: buildIceServers() });
});

// Host requests a short pairing code that the Client (phone) can enter / scan.
app.post('/pair/new', (req, res) => {
  if (SHARED_SECRET && req.header('x-shared-secret') !== SHARED_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const { code, sessionId, expiresAt } = pairing.create();
  res.json({ code, sessionId, expiresAt });
});

// Client resolves a pairing code -> sessionId so it can join the signaling room.
app.get('/pair/resolve/:code', (req, res) => {
  const entry = pairing.resolve(req.params.code);
  if (!entry) return res.status(404).json({ error: 'invalid_or_expired' });
  res.json({ sessionId: entry.sessionId });
});
attachPresenceBroadcast(io, users);
attachChatSignaling(io, users);

await initDb().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[signaling] database unreachable — is Postgres running? (docker compose up -d postgres)');
  console.error('[signaling] details:', e.message);
  process.exit(1);
});
await ensureLastSeenColumn().catch(() => {});

attachSignaling(io, pairing);
attachCallSignaling(io);
attachUserSignaling(io, users);

await initDb().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[signaling] database unreachable — is Postgres running? (docker compose up -d postgres)');
  console.error('[signaling] details:', e.message);
  process.exit(1);
});

server.listen(PORT, () => {
  const scheme = USE_HTTPS ? 'https' : 'http';
  // eslint-disable-next-line no-console
  console.log(`[signaling] listening on ${scheme}://0.0.0.0:${PORT}`);
});
