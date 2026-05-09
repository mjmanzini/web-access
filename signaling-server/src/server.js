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
import { mountWebAuthn, WEBAUTHN_SCHEMA_SQL } from './auth/webauthn.js';
import { mountOAuth, OAUTH_SCHEMA_SQL } from './auth/oauth.js';
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
const WEBAUTHN_ORIGIN = process.env.WEBAUTHN_ORIGIN || process.env.CLIENT_URL || 'http://localhost:3000';
const WEBAUTHN_RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Web-Access';
const WEBAUTHN_RP_ID = process.env.WEBAUTHN_RP_ID || new URL(WEBAUTHN_ORIGIN).hostname;
let dbReady = true;

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

const pairing = new PairingRegistry();
const users = new UserRegistry();

app.use(authMiddleware(users));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, sessions: pairing.size(), dbReady });
});

attachUserRoutes(app, users);
attachAuthRoutes(app, users);
mountWebAuthn(app, {
  rpID: WEBAUTHN_RP_ID,
  rpName: WEBAUTHN_RP_NAME,
  origin: WEBAUTHN_ORIGIN,
});
mountOAuth(app, {
  clientUrl: process.env.CLIENT_URL || WEBAUTHN_ORIGIN,
  callbackBase: process.env.OAUTH_CALLBACK_BASE
    || process.env.PUBLIC_SIGNALING_URL
    || `http://localhost:${PORT}`,
});
attachChatRoutes(app, requireAuth);
registerExtraSchema(OAUTH_SCHEMA_SQL);
attachPresenceRoutes(app, users, requireAuth);
attachRemoteRoutes(app, pairing, users, requireAuth);

registerExtraSchema(CHAT_SCHEMA_SQL);
registerExtraSchema(REMOTE_SCHEMA_SQL);
registerExtraSchema(WEBAUTHN_SCHEMA_SQL);

app.get('/ice', (_req, res) => {
  res.json({ iceServers: buildIceServers() });
});

app.post('/pair/new', (req, res) => {
  if (SHARED_SECRET && req.header('x-shared-secret') !== SHARED_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const { code, sessionId, expiresAt } = pairing.create();
  res.json({ code, sessionId, expiresAt });
});

app.get('/pair/resolve/:code', (req, res) => {
  const entry = pairing.resolve(req.params.code);
  if (!entry) return res.status(404).json({ error: 'invalid_or_expired' });
  res.json({ sessionId: entry.sessionId });
});

const server = USE_HTTPS
  ? https.createServer(
      await (async () => {
        const lanIp = detectLanIp();
        const { key, cert } = await loadOrCreateCert({ hosts: ['localhost', '127.0.0.1', lanIp] });
        return { key, cert };
      })(),
      app,
    )
  : http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

attachPresenceBroadcast(io, users);
attachChatSignaling(io, users);
attachSignaling(io, pairing);
attachCallSignaling(io);
attachUserSignaling(io, users);

await initDb().catch((e) => {
  dbReady = false;
  console.error('[signaling] database unreachable — is Postgres running? (docker compose up -d postgres)');
  console.error('[signaling] details:', e.message);
});
if (dbReady) {
  await ensureLastSeenColumn().catch(() => {});
}

server.listen(PORT, () => {
  const scheme = USE_HTTPS ? 'https' : 'http';
  console.log(`[signaling] listening on ${scheme}://0.0.0.0:${PORT}`);
  console.log(`[signaling] webauthn origin=${WEBAUTHN_ORIGIN} rpId=${WEBAUTHN_RP_ID}`);
});
