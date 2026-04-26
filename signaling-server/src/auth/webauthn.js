import crypto from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { pool } from '../db.js';

export const WEBAUTHN_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS auth_credentials (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_type TEXT NOT NULL CHECK (credential_type IN ('webauthn', 'session')),
  webauthn_cred_id BYTEA UNIQUE,
  webauthn_pubkey BYTEA,
  webauthn_counter BIGINT NOT NULL DEFAULT 0,
  webauthn_transports TEXT[],
  device_label TEXT,
  token_hash BYTEA,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS auth_credentials_user_idx ON auth_credentials(user_id);
CREATE INDEX IF NOT EXISTS auth_credentials_session_token_idx
  ON auth_credentials(token_hash) WHERE credential_type = 'session';

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  challenge BYTEA NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'authenticate', 'stepup')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '5 minutes'
);
CREATE INDEX IF NOT EXISTS webauthn_challenges_lookup_idx
  ON webauthn_challenges(user_id, purpose, expires_at DESC);
`;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function b64uToBuf(value) {
  return Buffer.from(String(value || ''), 'base64url');
}

function toB64u(value) {
  return Buffer.from(value).toString('base64url');
}

async function saveChallenge(userId, challenge, purpose) {
  await pool.query(
    `INSERT INTO webauthn_challenges (user_id, challenge, purpose) VALUES ($1, $2, $3)`,
    [userId, b64uToBuf(challenge), purpose],
  );
}

async function consumeChallenge(userId, purpose) {
  const { rows } = await pool.query(
    `DELETE FROM webauthn_challenges
      WHERE id = (
        SELECT id
          FROM webauthn_challenges
         WHERE (($1::text IS NULL AND user_id IS NULL) OR user_id = $1)
           AND purpose = $2
           AND expires_at > now()
         ORDER BY created_at DESC
         LIMIT 1
      )
      RETURNING challenge`,
    [userId, purpose],
  );
  return rows[0] ? toB64u(rows[0].challenge) : null;
}

async function issueSessionToken(userId, ttlSeconds = 60 * 60 * 24 * 30) {
  const raw = crypto.randomBytes(32);
  const token = toB64u(raw);
  await pool.query(
    `INSERT INTO auth_credentials (user_id, credential_type, token_hash, expires_at)
     VALUES ($1, 'session', $2, now() + make_interval(secs => $3))`,
    [userId, sha256(raw), ttlSeconds],
  );
  return token;
}

function issueStepupToken(userId, action) {
  const secret = process.env.WEBAUTHN_STEPUP_SECRET || process.env.TURN_SHARED_SECRET || 'dev-stepup-secret';
  const issuedAt = Date.now();
  const payload = JSON.stringify({ userId, action, issuedAt, exp: issuedAt + 5 * 60_000 });
  const body = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

async function findUserByUsername(username) {
  const { rows } = await pool.query(
    `SELECT id, username, display_name AS "displayName" FROM users WHERE lower(username) = lower($1)`,
    [username],
  );
  return rows[0] || null;
}

export function mountWebAuthn(app, { rpID, rpName, origin }) {
  app.post('/api/auth/webauthn/register/options', async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'unauthenticated' });

    const [userRes, credsRes] = await Promise.all([
      pool.query(`SELECT username, display_name FROM users WHERE id = $1`, [userId]),
      pool.query(
        `SELECT webauthn_cred_id, webauthn_transports
           FROM auth_credentials
          WHERE user_id = $1 AND credential_type = 'webauthn'`,
        [userId],
      ),
    ]);
    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ error: 'no_such_user' });

    const options = await generateRegistrationOptions({
      rpID,
      rpName,
      userID: userId,
      userName: user.username,
      userDisplayName: user.display_name,
      attestationType: 'none',
      excludeCredentials: credsRes.rows.map((row) => ({
        id: toB64u(row.webauthn_cred_id),
        transports: row.webauthn_transports ?? undefined,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });

    await saveChallenge(userId, options.challenge, 'register');
    res.json(options);
  });

  app.post('/api/auth/webauthn/register/verify', async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'unauthenticated' });

    const expectedChallenge = await consumeChallenge(userId, 'register');
    if (!expectedChallenge) return res.status(400).json({ error: 'no_challenge' });

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: req.body?.attResp,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch (error) {
      return res.status(400).json({ error: 'verify_failed', detail: error.message });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'not_verified' });
    }

    const credential = verification.registrationInfo.credential;
    await pool.query(
      `INSERT INTO auth_credentials (
         user_id, credential_type, webauthn_cred_id, webauthn_pubkey,
         webauthn_counter, webauthn_transports, device_label, last_used_at
       ) VALUES ($1, 'webauthn', $2, $3, $4, $5, $6, now())
       ON CONFLICT (webauthn_cred_id)
       DO UPDATE SET
         webauthn_pubkey = EXCLUDED.webauthn_pubkey,
         webauthn_counter = EXCLUDED.webauthn_counter,
         webauthn_transports = EXCLUDED.webauthn_transports,
         device_label = COALESCE(EXCLUDED.device_label, auth_credentials.device_label),
         last_used_at = now()`,
      [
        userId,
        b64uToBuf(credential.id),
        Buffer.from(credential.publicKey),
        Number(credential.counter || 0),
        req.body?.attResp?.response?.transports ?? null,
        req.body?.deviceLabel ?? null,
      ],
    );

    res.json({ verified: true, credentialId: credential.id });
  });

  app.post('/api/auth/webauthn/authenticate/options', async (req, res) => {
    const username = String(req.body?.username || '').trim();
    let userId = null;
    let allowCredentials;

    if (username) {
      const user = await findUserByUsername(username);
      if (!user) return res.status(404).json({ error: 'no_such_user' });
      userId = user.id;
      const { rows } = await pool.query(
        `SELECT webauthn_cred_id, webauthn_transports
           FROM auth_credentials
          WHERE user_id = $1 AND credential_type = 'webauthn'`,
        [userId],
      );
      allowCredentials = rows.map((row) => ({
        id: toB64u(row.webauthn_cred_id),
        transports: row.webauthn_transports ?? undefined,
      }));
    }

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      allowCredentials,
    });
    await saveChallenge(userId, options.challenge, 'authenticate');
    res.json(options);
  });

  app.post('/api/auth/webauthn/authenticate/verify', async (req, res) => {
    const assertion = req.body?.assertion;
    if (!assertion?.id) return res.status(400).json({ error: 'no_assertion' });

    const credentialId = b64uToBuf(assertion.id);
    const { rows } = await pool.query(
      `SELECT ac.id, ac.user_id, ac.webauthn_pubkey, ac.webauthn_counter, ac.webauthn_transports,
              u.username, u.display_name AS "displayName"
         FROM auth_credentials ac
         JOIN users u ON u.id = ac.user_id
        WHERE ac.credential_type = 'webauthn' AND ac.webauthn_cred_id = $1`,
      [credentialId],
    );
    const credential = rows[0];
    if (!credential) return res.status(404).json({ error: 'unknown_credential' });

    const expectedChallenge =
      await consumeChallenge(credential.user_id, 'authenticate') ||
      await consumeChallenge(null, 'authenticate');
    if (!expectedChallenge) return res.status(400).json({ error: 'no_challenge' });

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: credentialId,
          publicKey: credential.webauthn_pubkey,
          counter: Number(credential.webauthn_counter || 0),
          transports: credential.webauthn_transports ?? undefined,
        },
      });
    } catch (error) {
      return res.status(400).json({ error: 'verify_failed', detail: error.message });
    }

    if (!verification.verified) return res.status(401).json({ error: 'not_verified' });

    await pool.query(
      `UPDATE auth_credentials SET webauthn_counter = $1, last_used_at = now() WHERE id = $2`,
      [verification.authenticationInfo.newCounter, credential.id],
    );

    const token = await issueSessionToken(credential.user_id);
    res.json({
      verified: true,
      userId: credential.user_id,
      token,
      user: {
        id: credential.user_id,
        username: credential.username,
        displayName: credential.displayName,
      },
    });
  });

  app.post('/api/auth/webauthn/stepup/options', async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'unauthenticated' });

    const { rows } = await pool.query(
      `SELECT webauthn_cred_id, webauthn_transports
         FROM auth_credentials
        WHERE user_id = $1 AND credential_type = 'webauthn'`,
      [userId],
    );
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      allowCredentials: rows.map((row) => ({
        id: toB64u(row.webauthn_cred_id),
        transports: row.webauthn_transports ?? undefined,
      })),
    });
    await saveChallenge(userId, options.challenge, 'stepup');
    res.json(options);
  });

  app.post('/api/auth/webauthn/stepup/verify', async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'unauthenticated' });

    const assertion = req.body?.assertion;
    if (!assertion?.id) return res.status(400).json({ error: 'no_assertion' });

    const credentialId = b64uToBuf(assertion.id);
    const { rows } = await pool.query(
      `SELECT id, user_id, webauthn_pubkey, webauthn_counter, webauthn_transports
         FROM auth_credentials
        WHERE credential_type = 'webauthn'
          AND user_id = $1
          AND webauthn_cred_id = $2`,
      [userId, credentialId],
    );
    const credential = rows[0];
    if (!credential) return res.status(404).json({ error: 'unknown_credential' });

    const expectedChallenge = await consumeChallenge(userId, 'stepup');
    if (!expectedChallenge) return res.status(400).json({ error: 'no_challenge' });

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: credentialId,
          publicKey: credential.webauthn_pubkey,
          counter: Number(credential.webauthn_counter || 0),
          transports: credential.webauthn_transports ?? undefined,
        },
      });
    } catch (error) {
      return res.status(400).json({ error: 'verify_failed', detail: error.message });
    }

    if (!verification.verified) return res.status(401).json({ error: 'not_verified' });

    await pool.query(
      `UPDATE auth_credentials SET webauthn_counter = $1, last_used_at = now() WHERE id = $2`,
      [verification.authenticationInfo.newCounter, credential.id],
    );

    res.json({ verified: true, stepupToken: issueStepupToken(userId, req.body?.action || 'unknown') });
  });
}
