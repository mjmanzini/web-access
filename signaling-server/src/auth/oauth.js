/**
 * oauth.js — frictionless social login (Google, GitHub, ...).
 *
 * Flow:
 *   1. Client opens `/api/auth/oauth/:provider/start`.
 *   2. Server signs a short-lived `state` (HMAC) and 302s to provider consent.
 *   3. Provider redirects back to `/api/auth/oauth/:provider/callback?code&state`.
 *   4. Server exchanges code for an access token, fetches the user profile,
 *      finds-or-creates a local user (linked via `oauth_identities`), issues a
 *      session token compatible with the existing bearer-token middleware, and
 *      redirects to `${CLIENT_URL}/onboarding/callback?token=...&new=0|1`.
 *
 * Adding a provider = add a record to PROVIDERS below + matching env vars.
 * No external OAuth dependency — uses Node 18+ fetch + crypto only.
 */
import crypto from 'node:crypto';
import { logEvent } from '../db.js';
import { createStorage } from '../storage/index.js';

export const OAUTH_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS oauth_identities (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  PRIMARY KEY (provider, provider_user_id)
);
ALTER TABLE oauth_identities ADD COLUMN IF NOT EXISTS refresh_token TEXT;
ALTER TABLE oauth_identities ADD COLUMN IF NOT EXISTS access_token TEXT;
ALTER TABLE oauth_identities ADD COLUMN IF NOT EXISTS access_token_exp TIMESTAMPTZ;
ALTER TABLE oauth_identities ADD COLUMN IF NOT EXISTS scope TEXT;
CREATE INDEX IF NOT EXISTS oauth_identities_user_idx ON oauth_identities(user_id);
CREATE INDEX IF NOT EXISTS oauth_identities_email_idx ON oauth_identities(email);
`;

// ---------------------------------------------------------------------------
// Provider catalog
// ---------------------------------------------------------------------------

/** @typedef {{
 *   id: string,
 *   label: string,
 *   authUrl: string,
 *   tokenUrl: string,
 *   userinfoUrl: string,
 *   scope: string,
 *   clientId?: string,
 *   clientSecret?: string,
 *   parseProfile: (raw: any, accessToken: string) => Promise<{providerUserId:string,email?:string,displayName:string}>
 * }} Provider
 */

/** @returns {Record<string, Provider>} */
function buildProviders() {
  return {
    google: {
      id: 'google',
      label: 'Google',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      parseProfile: async (p) => ({
        providerUserId: String(p.sub),
        email: p.email || undefined,
        displayName: p.name || p.given_name || p.email || 'Google User',
      }),
    },
    github: {
      id: 'github',
      label: 'GitHub',
      authUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      userinfoUrl: 'https://api.github.com/user',
      scope: 'read:user user:email',
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
      parseProfile: async (p, accessToken) => {
        let email = p.email;
        if (!email) {
          // GitHub may keep email private; fetch the verified one.
          const r = await fetch('https://api.github.com/user/emails', {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/vnd.github+json',
              'User-Agent': 'web-access',
            },
          });
          if (r.ok) {
            const list = await r.json();
            const primary = Array.isArray(list)
              ? (list.find((e) => e.primary && e.verified) || list.find((e) => e.verified))
              : null;
            if (primary?.email) email = primary.email;
          }
        }
        return {
          providerUserId: String(p.id),
          email: email || undefined,
          displayName: p.name || p.login || 'GitHub User',
        };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// State signing (HMAC, no DB) — defends against CSRF on the callback.
// ---------------------------------------------------------------------------

function stateSecret() {
  return process.env.OAUTH_STATE_SECRET
      || process.env.WEBAUTHN_STEPUP_SECRET
      || process.env.SIGNALING_SHARED_SECRET
      || 'dev-oauth-state-secret';
}

function signState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyState(state) {
  if (!state || typeof state !== 'string' || !state.includes('.')) return null;
  const [body, sig] = state.split('.');
  const expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
  catch { return null; }
  if (!payload?.exp || payload.exp < Date.now()) return null;
  return payload;
}

// ---------------------------------------------------------------------------
// Session-token issuance — mirrors webauthn.js so the bearer middleware works.
// ---------------------------------------------------------------------------

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest(); }
function toB64u(value) { return Buffer.from(value).toString('base64url'); }

async function issueSessionToken(storage, userId, ttlSeconds = 60 * 60 * 24 * 30) {
  const raw = crypto.randomBytes(32);
  const token = toB64u(raw);
  await storage.auth.issueSessionToken({ userId, tokenHash: sha256(raw), ttlSeconds });
  return token;
}

// ---------------------------------------------------------------------------
// User find-or-create
// ---------------------------------------------------------------------------

function randomId(bytes = 6) { return crypto.randomBytes(bytes).toString('hex'); }
function randomToken() { return crypto.randomBytes(32).toString('base64url'); }

function deriveUsername(profile) {
  const base = (profile.email && profile.email.split('@')[0])
            || profile.displayName?.toLowerCase().replace(/\s+/g, '.')
            || 'user';
  return base.toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 24) || 'user';
}

async function findOrCreateUser(storage, provider, profile) {
  // 1. Existing oauth identity?
  const existing = await storage.auth.findOAuthIdentityUser({
    provider,
    providerUserId: profile.providerUserId,
  });
  if (existing) {
    await storage.auth.touchOAuthIdentityLogin({
      provider,
      providerUserId: profile.providerUserId,
    }).catch(() => {});
    return { user: existing, created: false };
  }

  // 2. Same email as a local user? Link.
  if (profile.email) {
    const byEmail = await storage.auth.findUserByEmail(profile.email).catch(() => null);
    if (byEmail) {
      await storage.auth.upsertOAuthIdentity({
        provider,
        providerUserId: profile.providerUserId,
        userId: byEmail.id,
        email: profile.email,
      });
      return { user: byEmail, created: false };
    }
  }

  // 3. Create new user. Pick a unique username with retries on collision.
  const base = deriveUsername(profile);
  let username = base;
  let id = '';
  const display = profile.displayName.trim().slice(0, 40) || base;
  for (let attempt = 0; attempt < 6; attempt++) {
    id = randomId();
    const candidate = attempt === 0 ? base : `${base}.${crypto.randomBytes(2).toString('hex')}`;
    try {
      await storage.users.createUser({
        id,
        username: candidate,
        displayName: display,
        token: randomToken(),
      });
      username = candidate;
      break;
    } catch (e) {
      if (String(e.code) !== '23505') throw e;
      if (attempt === 5) throw new Error('username_taken');
    }
  }

  // Best-effort: stash email if column exists.
  if (profile.email) {
    await storage.auth.updateUserEmail({ userId: id, email: profile.email })
      .catch(() => {});
  }

  await storage.auth.createOAuthIdentity({
    provider,
    providerUserId: profile.providerUserId,
    userId: id,
    email: profile.email || null,
  });

  logEvent('oauth_user_created', { userId: id, payload: { provider, email: profile.email } });
  return { user: { id, username, displayName: display }, created: true };
}

// ---------------------------------------------------------------------------
// Express mount
// ---------------------------------------------------------------------------

/**
 * @param {import('express').Express} app
 * @param {{ clientUrl: string, callbackBase: string }} cfg
 *   clientUrl    - origin of the web client (where users are sent after login)
 *   callbackBase - public origin of THIS server (used to build redirect_uri)
 */
export function mountOAuth(app, { clientUrl, callbackBase }, storage = createStorage()) {
  const providers = buildProviders();
  const isEnabled = (p) => Boolean(p.clientId && p.clientSecret);
  const enabledIds = Object.values(providers).filter(isEnabled).map((p) => p.id);

  // Lightweight discovery endpoint so the client can render only the
  // providers that are actually configured.
  app.get('/api/auth/oauth/providers', (_req, res) => {
    res.json({
      providers: Object.values(providers)
        .filter(isEnabled)
        .map((p) => ({ id: p.id, label: p.label })),
    });
  });

  if (enabledIds.length === 0) {
    console.log('[oauth] no providers configured (set GOOGLE_CLIENT_ID/SECRET, GITHUB_CLIENT_ID/SECRET, ...)');
  } else {
    console.log(`[oauth] enabled providers: ${enabledIds.join(', ')}`);
  }

  app.get('/api/auth/oauth/:provider/start', (req, res) => {
    const provider = providers[req.params.provider];
    if (!provider || !isEnabled(provider)) {
      return res.status(404).json({ error: 'provider_not_configured' });
    }
    const redirectUri = `${callbackBase}/api/auth/oauth/${provider.id}/callback`;
    const state = signState({
      p: provider.id,
      n: crypto.randomBytes(8).toString('base64url'),
      r: typeof req.query.return === 'string' ? req.query.return.slice(0, 200) : '/chat',
      exp: Date.now() + 10 * 60_000,
    });
    const params = new URLSearchParams({
      client_id: provider.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: provider.scope,
      state,
    });
    if (provider.id === 'google') {
      // offline + consent so we receive a refresh_token for Drive backups.
      params.set('access_type', 'offline');
      params.set('include_granted_scopes', 'true');
      params.set('prompt', 'consent');
    }
    res.redirect(`${provider.authUrl}?${params.toString()}`);
  });

  app.get('/api/auth/oauth/:provider/callback', async (req, res) => {
    const provider = providers[req.params.provider];
    if (!provider || !isEnabled(provider)) {
      return res.status(404).send('Provider not configured');
    }
    const errParam = req.query.error;
    if (errParam) {
      return res.redirect(`${clientUrl}/onboarding?error=${encodeURIComponent(String(errParam))}`);
    }

    const stateOk = verifyState(req.query.state);
    if (!stateOk || stateOk.p !== provider.id) {
      return res.status(400).send('Invalid or expired OAuth state. Please retry.');
    }
    const code = String(req.query.code || '');
    if (!code) return res.status(400).send('Missing authorization code');

    const redirectUri = `${callbackBase}/api/auth/oauth/${provider.id}/callback`;

    try {
      // 1) Exchange code for access token.
      const tokenRes = await fetch(provider.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'web-access',
        },
        body: new URLSearchParams({
          client_id: provider.clientId,
          client_secret: provider.clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) {
        const txt = await tokenRes.text();
        console.error('[oauth] token exchange failed:', tokenRes.status, txt);
        return res.redirect(`${clientUrl}/onboarding?error=token_exchange_failed`);
      }
      const tokenJson = await tokenRes.json();
      const accessToken = tokenJson.access_token;
      if (!accessToken) {
        return res.redirect(`${clientUrl}/onboarding?error=no_access_token`);
      }

      // 2) Fetch userinfo.
      const userinfoRes = await fetch(provider.userinfoUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'User-Agent': 'web-access',
        },
      });
      if (!userinfoRes.ok) {
        return res.redirect(`${clientUrl}/onboarding?error=userinfo_failed`);
      }
      const rawProfile = await userinfoRes.json();
      const profile = await provider.parseProfile(rawProfile, accessToken);
      if (!profile.providerUserId) {
        return res.redirect(`${clientUrl}/onboarding?error=invalid_profile`);
      }

      // 3) Find-or-create local user, issue session token.
      const { user, created } = await findOrCreateUser(storage, provider.id, profile);
      const token = await issueSessionToken(storage, user.id);

      // 3b) Persist Google offline tokens for Drive uploads.
      if (provider.id === 'google' && (tokenJson.refresh_token || tokenJson.access_token)) {
        try {
          await storage.auth.setOAuthTokens?.({
            provider: provider.id,
            providerUserId: profile.providerUserId,
            refreshToken: tokenJson.refresh_token || null,
            accessToken: tokenJson.access_token || null,
            expiresAt: tokenJson.expires_in
              ? Date.now() + (Number(tokenJson.expires_in) - 60) * 1000
              : null,
            scope: tokenJson.scope || provider.scope,
          });
        } catch (e) { console.warn('[oauth] setOAuthTokens failed:', e?.message || e); }
      }

      logEvent('oauth_login', { userId: user.id, payload: { provider: provider.id, created } });

      // 4) Redirect back to the web client with the token (one-time URL).
      const target = new URL(`${clientUrl}/onboarding/callback`);
      target.searchParams.set('token', token);
      target.searchParams.set('provider', provider.id);
      target.searchParams.set('new', created ? '1' : '0');
      target.searchParams.set('return', stateOk.r || '/chat');
      res.redirect(target.toString());
    } catch (e) {
      console.error('[oauth] callback error:', e);
      res.redirect(`${clientUrl}/onboarding?error=oauth_failed`);
    }
  });
}
