-- =============================================================================
-- Unified Comms + Remote Desktop PWA — PostgreSQL schema
-- Target: PostgreSQL 14+
-- Run:    psql "$DATABASE_URL" -f docs/schema.sql
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;       -- case-insensitive emails/usernames

-- -----------------------------------------------------------------------------
-- USERS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        CITEXT UNIQUE NOT NULL,
    display_name    TEXT   NOT NULL,
    email           CITEXT UNIQUE,
    phone           TEXT   UNIQUE,
    avatar_url      TEXT,
    -- TeamViewer-style stable public ID shown on the Remote dashboard
    remote_id       TEXT   UNIQUE NOT NULL DEFAULT lpad((floor(random()*1e9))::int::text, 9, '0'),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at DESC);

-- -----------------------------------------------------------------------------
-- AUTH CREDENTIALS  (passwords + WebAuthn passkeys + opaque session tokens)
-- credential_type: 'password' | 'webauthn' | 'session'
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_credentials (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_type     TEXT NOT NULL CHECK (credential_type IN ('password','webauthn','session')),

    -- password
    password_hash       TEXT,                -- argon2id

    -- webauthn (FIDO2 passkey)
    webauthn_cred_id    BYTEA UNIQUE,        -- credentialID
    webauthn_pubkey     BYTEA,               -- COSE public key
    webauthn_counter    BIGINT DEFAULT 0,
    webauthn_transports TEXT[],              -- ['internal','hybrid','usb',...]
    device_label        TEXT,                -- "iPhone 15 Face ID"

    -- session token (opaque, hashed)
    token_hash          BYTEA,
    expires_at          TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_authcreds_user ON auth_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_authcreds_token_hash ON auth_credentials(token_hash) WHERE credential_type='session';

-- One-shot challenges for WebAuthn (registration + assertion)
CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    challenge   BYTEA NOT NULL,
    purpose     TEXT  NOT NULL CHECK (purpose IN ('register','authenticate')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '5 minutes'
);
CREATE INDEX IF NOT EXISTS idx_wa_challenges_expiry ON webauthn_challenges(expires_at);

-- -----------------------------------------------------------------------------
-- CONTACTS  (directed relationship; mutual when both rows exist)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contacts (
    owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname    TEXT,
    favorite    BOOLEAN NOT NULL DEFAULT false,
    blocked     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, contact_id),
    CHECK (owner_id <> contact_id)
);

-- -----------------------------------------------------------------------------
-- CHAT — conversations + messages (1:1 and group ready)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_group    BOOLEAN NOT NULL DEFAULT false,
    title       TEXT,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_msg_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_read_at    TIMESTAMPTZ,
    role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body            TEXT,                                         -- ciphertext or plaintext
    media_url       TEXT,
    media_kind      TEXT CHECK (media_kind IN ('image','audio','video','file')),
    reply_to_id     UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at       TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_msgs_convo_time ON chat_messages(conversation_id, created_at DESC);

-- Per-user delivery / read receipts (WhatsApp ticks)
CREATE TABLE IF NOT EXISTS message_receipts (
    message_id   UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delivered_at TIMESTAMPTZ,
    read_at      TIMESTAMPTZ,
    PRIMARY KEY (message_id, user_id)
);

-- -----------------------------------------------------------------------------
-- CALL LOGS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS call_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    caller_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_kind      TEXT NOT NULL CHECK (media_kind IN ('audio','video')),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    answered_at     TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    end_reason      TEXT CHECK (end_reason IN ('completed','missed','declined','failed','cancelled'))
);

CREATE TABLE IF NOT EXISTS call_participants (
    call_id   UUID NOT NULL REFERENCES call_logs(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ,
    left_at   TIMESTAMPTZ,
    PRIMARY KEY (call_id, user_id)
);

-- -----------------------------------------------------------------------------
-- REMOTE DESKTOP SESSIONS  (TeamViewer-style PIN handshake)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS remote_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewer_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    pin_hash        BYTEA NOT NULL,           -- bcrypt/argon2 of 6-digit PIN
    pin_expires_at  TIMESTAMPTZ NOT NULL,
    pin_attempts    INT NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','active','ended','denied','expired')),
    permissions     JSONB NOT NULL DEFAULT '{"view":true,"input":true,"clipboard":false,"file_transfer":false}',
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    end_reason      TEXT,
    bytes_in        BIGINT NOT NULL DEFAULT 0,
    bytes_out       BIGINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_remote_sessions_host ON remote_sessions(host_user_id, status);
CREATE INDEX IF NOT EXISTS idx_remote_sessions_pin_expiry ON remote_sessions(pin_expires_at);

-- Per-session audit trail (input events sampled, connection state changes)
CREATE TABLE IF NOT EXISTS remote_session_events (
    id          BIGSERIAL PRIMARY KEY,
    session_id  UUID NOT NULL REFERENCES remote_sessions(id) ON DELETE CASCADE,
    at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind        TEXT NOT NULL,             -- 'connect','disconnect','denied','warn'
    payload     JSONB
);
CREATE INDEX IF NOT EXISTS idx_rse_session ON remote_session_events(session_id, at);

-- -----------------------------------------------------------------------------
-- HOUSEKEEPING
-- -----------------------------------------------------------------------------
-- Run from a cron / scheduled job:
--   DELETE FROM webauthn_challenges WHERE expires_at < now();
--   UPDATE remote_sessions SET status='expired'
--     WHERE status='pending' AND pin_expires_at < now();
