/**
 * WebAuthn server flows — registration, authentication, step-up.
 *
 * Install:
 *   npm i @simplewebauthn/server
 *
 * Wire-up (in src/server.js):
 *   import { mountWebAuthn } from './auth/webauthn.js';
 *   mountWebAuthn(app, { rpID: 'app.example.com', rpName: 'Web-Access',
 *                       origin: 'https://app.example.com' });
 *
 * Storage uses the schema in docs/schema.sql:
 *   - users
 *   - auth_credentials   (credential_type='webauthn' | 'session')
 *   - webauthn_challenges
 */
import crypto from 'node:crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { pool } from '../db.js';

function b64uToBuf(b64u) {
  return Buffer.from(b64u.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function bufToB64u(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest(); }

async function saveChallenge(userId, challenge, purpose) {
  await pool.query(
    `INSERT INTO webauthn_challenges (user_id, challenge, purpose) VALUES ($1, $2, $3)`,
    [userId, Buffer.from(challenge, 'base64url'), purpose],
  );
}
async function consumeChallenge(userId, purpose) {
  const { rows } = await pool.query(
    `DELETE FROM webauthn_challenges
       WHERE ctid IN (
         SELECT ctid FROM webauthn_challenges
          WHERE (user_id = $1 OR ($1 IS NULL AND user_id IS NULL))
            AND purpose = $2 AND expires_at > now()
          ORDER BY created_at DESC LIMIT 1
       )
     RETURNING challenge`,
    [userId, purpose],
  );
  if (!rows[0]) return null;
  return rows[0].challenge.toString('base64url');
}

async function issueSessionToken(userId) {
  const raw = crypto.randomBytes(32);
  const token = bufToB64u(raw);
  await pool.query(
    `INSERT INTO auth_credentials (user_id, credential_type, token_hash, expires_at)
     VALUES ($1, 'session', $2, now() + INTERVAL '30 days')`,
    [userId, sha256(raw)],
  );
  return token;
}

export function mountWebAuthn(app, { rpID, rpName, origin }) {
  // ---- REGISTRATION ------------------------------------------------------
  app.post('/api/auth/webauthn/register/options', async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'unauthenticated' });

    const { rows: existing } = await pool.query(
      `SELECT webauthn_cred_id, webauthn_transports
         FROM auth_credentials
        WHERE user_id = $1 AND credential_type='webauthn'`,
      [userId],
    );
    const { rows: u } = await pool.query(
      `SELECT username, display_name FROM users WHERE id=$1`, [userId]);

    const options = await generateRegistrationOptions({
      rpName, rpID,
      userID: Buffer.from(userId),
      userName: u[0].username,
      userDisplayName: u[0].display_name,
      attestationType: 'none',
      excludeCredentials: existing.map(c => ({
        id: c.webauthn_cred_id, transports: c.webauthn_transports ?? undefined,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',         // discoverable credential = passwordless tap
        userVerification: 'required',     // forces Face ID / fingerprint / PIN
      },
    });
    await saveChallenge(userId, options.challenge, 'register');
    res.json(options);
  });

  app.post('/api/auth/webauthn/register/verify', async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'unauthenticated' });
    const { attResp, deviceLabel } = req.body ?? {};
    const expectedChallenge = await consumeChallenge(userId, 'register');
    if (!expectedChallenge) return res.status(400).json({ error: 'no_challenge' });

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: attResp,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch (e) {
      return res.status(400).json({ error: 'verify_failed', detail: e.message });
    }
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'not_verified' });
    }
    const { credential } = verification.registrationInfo;
    await pool.query(
      `INSERT INTO auth_credentials
         (user_id, credential_type, webauthn_cred_id, webauthn_pubkey,
          webauthn_counter, webauthn_transports, device_label)
       VALUES ($1,'webauthn',$2,$3,$4,$5,$6)`,
      [
        userId,
        Buffer.from(credential.id),
        Buffer.from(credential.publicKey),
        credential.counter ?? 0,
        attResp?.response?.transports ?? null,
        deviceLabel ?? null,
      ],
    );
    res.json({ verified: true, credentialId: bufToB64u(credential.id) });
  });

  // ---- AUTHENTICATION ----------------------------------------------------
  app.post('/api/auth/webauthn/authenticate/options', async (req, res) => {
    const { username } = req.body ?? {};
    let userId = null, allowCredentials;

    if (username) {
      const { rows } = await pool.query(`SELECT id FROM users WHERE username=$1`, [username]);
      if (!rows[0]) return res.status(404).json({ error: 'no_such_user' });
      userId = rows[0].id;
      const { rows: creds } = await pool.query(
        `SELECT webauthn_cred_id, webauthn_transports
           FROM auth_credentials
          WHERE user_id=$1 AND credential_type='webauthn'`, [userId]);
      allowCredentials = creds.map(c => ({
        id: c.webauthn_cred_id, transports: c.webauthn_transports ?? undefined,
      }));
    }

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      allowCredentials, // omitted -> discoverable credential flow
    });
    await saveChallenge(userId, options.challenge, 'authenticate');
    res.json(options);
  });

  app.post('/api/auth/webauthn/authenticate/verify', async (req, res) => {
    const { assertion } = req.body ?? {};
    if (!assertion?.id) return res.status(400).json({ error: 'no_assertion' });

    const credIdBuf = b64uToBuf(assertion.id);
    const { rows: creds } = await pool.query(
      `SELECT ac.id, ac.user_id, ac.webauthn_pubkey, ac.webauthn_counter,
              ac.webauthn_transports
         FROM auth_credentials ac
        WHERE ac.credential_type='webauthn' AND ac.webauthn_cred_id=$1`,
      [credIdBuf],
    );
    const cred = creds[0];
    if (!cred) return res.status(404).json({ error: 'unknown_credential' });

    const expectedChallenge = await consumeChallenge(cred.user_id, 'authenticate')
      ?? await consumeChallenge(null, 'authenticate'); // discoverable flow
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
          id: credIdBuf,
          publicKey: cred.webauthn_pubkey,
          counter: Number(cred.webauthn_counter),
          transports: cred.webauthn_transports ?? undefined,
        },
      });
    } catch (e) {
      return res.status(400).json({ error: 'verify_failed', detail: e.message });
    }
    if (!verification.verified) return res.status(401).json({ error: 'not_verified' });

    await pool.query(
      `UPDATE auth_credentials
          SET webauthn_counter=$1, last_used_at=now()
        WHERE id=$2`,
      [verification.authenticationInfo.newCounter, cred.id],
    );

    const token = await issueSessionToken(cred.user_id);
    res.json({ verified: true, userId: cred.user_id, token });
  });
}
