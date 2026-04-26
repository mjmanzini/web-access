/**
 * db.js — Postgres pool + schema bootstrap.
 *
 * Tables:
 *  - users                     (directory + login token)
 *  - calls                     (one row per call room started)
 *  - call_participants         (who joined, when, who left)
 *  - chat_messages             (persistent chat — live transactions)
 *  - call_events               (append-only event log for audit/observability)
 *
 * All mutations go through short-lived client connections from a pool so
 * we can handle concurrent "live transactions" (joins, leaves, chat bursts).
 */
import pg from 'pg';

const { Pool } = pg;

const CONNECTION_STRING =
  process.env.DATABASE_URL ||
  `postgres://${process.env.POSTGRES_USER || 'webaccess'}:${process.env.POSTGRES_PASSWORD || 'webaccess'}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || 'webaccess'}`;

export const pool = new Pool({
  connectionString: CONNECTION_STRING,
  max: 20,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] pool error', err.message);
});

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  token         TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_username_idx ON users(username);

CREATE TABLE IF NOT EXISTS calls (
  room_id       TEXT PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'meeting',
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS call_participants (
  id            BIGSERIAL PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES calls(room_id) ON DELETE CASCADE,
  user_id       TEXT,
  peer_id       TEXT NOT NULL,
  name          TEXT,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS call_participants_room_idx ON call_participants(room_id);
CREATE INDEX IF NOT EXISTS call_participants_user_idx ON call_participants(user_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id            BIGSERIAL PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES calls(room_id) ON DELETE CASCADE,
  from_peer     TEXT NOT NULL,
  from_name     TEXT,
  text          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_room_idx ON chat_messages(room_id);

CREATE TABLE IF NOT EXISTS call_events (
  id            BIGSERIAL PRIMARY KEY,
  room_id       TEXT,
  user_id       TEXT,
  type          TEXT NOT NULL,
  payload       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS call_events_room_idx ON call_events(room_id);
CREATE INDEX IF NOT EXISTS call_events_type_idx ON call_events(type);
`;

/**
 * Additional v2 schema chunks (chat conversations, remote-desktop sessions).
 * Registered via registerExtraSchema() so feature modules stay self-contained.
 */
const EXTRA_SCHEMA = [];
export function registerExtraSchema(sql) { EXTRA_SCHEMA.push(sql); }

let initialized = false;
export async function initDb() {
  if (initialized) return;
  try {
    await pool.query(SCHEMA_SQL);
    for (const extra of EXTRA_SCHEMA) {
      try { await pool.query(extra); }
      catch (e) { console.warn('[db] extra schema chunk failed:', e.message); }
    }
    initialized = true;
    // eslint-disable-next-line no-console
    console.log('[db] schema ready');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[db] schema init failed:', e.message);
    throw e;
  }
}

/** Append-only event logger — never throws to callers. */
export async function logEvent(type, { roomId = null, userId = null, payload = null } = {}) {
  try {
    await pool.query(
      'INSERT INTO call_events (room_id, user_id, type, payload) VALUES ($1, $2, $3, $4)',
      [roomId, userId, type, payload ? JSON.stringify(payload) : null],
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[db] logEvent failed:', e.message);
  }
}

export async function upsertCallRoom(roomId, kind = 'meeting') {
  await pool.query(
    `INSERT INTO calls (room_id, kind) VALUES ($1, $2)
     ON CONFLICT (room_id) DO NOTHING`,
    [roomId, kind],
  );
}
export async function recordParticipantJoin(roomId, { peerId, userId = null, name = null }) {
  const { rows } = await pool.query(
    `INSERT INTO call_participants (room_id, user_id, peer_id, name)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [roomId, userId, peerId, name],
  );
  return rows[0]?.id || null;
}
export async function recordParticipantLeave(participantId) {
  if (!participantId) return;
  await pool.query(
    'UPDATE call_participants SET left_at = now() WHERE id = $1 AND left_at IS NULL',
    [participantId],
  );
}
export async function markRoomEnded(roomId) {
  await pool.query(
    'UPDATE calls SET ended_at = now() WHERE room_id = $1 AND ended_at IS NULL',
    [roomId],
  );
}
export async function saveChatMessage(roomId, { fromPeer, fromName, text }) {
  await pool.query(
    `INSERT INTO chat_messages (room_id, from_peer, from_name, text) VALUES ($1, $2, $3, $4)`,
    [roomId, fromPeer, fromName, text],
  );
}
