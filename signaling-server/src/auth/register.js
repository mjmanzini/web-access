/**
 * register.js — frictionless registration endpoint for the PWA onboarding flow.
 *
 * POST /api/auth/register   { displayName, email?, phone?, username? }
 *   -> 200 { id, username, displayName, token }
 *
 * Username is derived from email/phone when not provided. Returns a long-lived
 * token compatible with the existing users.loginByToken middleware.
 */
import crypto from 'node:crypto';
import { createStorage } from '../storage/index.js';

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest(); }

async function issueSession(storage, user) {
  const raw = crypto.randomBytes(32);
  const token = raw.toString('base64url');
  await storage.auth.issueSessionToken({
    userId: user.id,
    tokenHash: sha256(raw),
    ttlSeconds: 60 * 60 * 24 * 365,
  });
  return { ...user, token };
}

function deriveUsername({ username, email, phone, displayName }) {
  if (username) return username;
  if (email) return email.split('@')[0];
  if (phone) return 'u' + phone.replace(/\D/g, '').slice(-9);
  if (displayName) return displayName.toLowerCase().replace(/\s+/g, '.');
  return 'u' + crypto.randomBytes(4).toString('hex');
}

export function attachAuthRoutes(app, users, storage = createStorage()) {
  app.post('/api/auth/register', async (req, res) => {
    const { displayName, email, phone, username } = req.body || {};
    if (!displayName || String(displayName).trim().length < 2) {
      return res.status(400).json({ error: 'invalid_display_name' });
    }
    if (!email && !phone) {
      return res.status(400).json({ error: 'email_or_phone_required' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'invalid_email' });
    }
    if (phone && !/^\+?[\d\s-]{7,}$/.test(phone)) {
      return res.status(400).json({ error: 'invalid_phone' });
    }

    let uname = deriveUsername({ username, email, phone, displayName });

    if (email) {
      const existing = await storage.auth.findUserByEmail(email).catch(() => null);
      if (existing) {
        await storage.auth.updateUserContact({
          userId: existing.id,
          email,
          phone: phone || null,
        }).catch(() => {});
        return res.json(await issueSession(storage, existing));
      }
    }

    // Try to register; on collision, append a short suffix and retry up to 5x.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const candidate = attempt === 0 ? uname : `${uname}.${crypto.randomBytes(2).toString('hex')}`;
        const u = await users.register({ username: candidate, displayName });
        // Best-effort: persist contact details when the active storage backend supports them.
        try {
          await storage.auth.updateUserContact({
            userId: u.id,
            email: email || null,
            phone: phone || null,
          });
        } catch { /* legacy backend without contact fields */ }
        return res.json(u);
      } catch (e) {
        if (e.message !== 'username_taken') {
          return res.status(400).json({ error: e.message || 'register_failed' });
        }
      }
    }
    res.status(409).json({ error: 'username_taken' });
  });

  app.get('/api/me', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    res.json({ user: req.user });
  });
}
