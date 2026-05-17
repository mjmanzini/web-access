import { pool, registerExtraSchema } from '../db.js';
import { createStorage } from '../storage/index.js';
import { getFirestore } from './firestore.js';
import { balance } from './wallet.js';
import { computeTrustScore } from './trust.js';

const storage = createStorage();
const memProfiles = new Map();
const memUsers = new Map();

export const KHULOH_PROFILE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS khuloh_profiles (
  user_id             TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio                 TEXT NOT NULL DEFAULT '',
  vibe                TEXT NOT NULL DEFAULT 'chat',
  city                TEXT,
  is_verified         BOOLEAN NOT NULL DEFAULT false,
  is_shadow_banned    BOOLEAN NOT NULL DEFAULT false,
  data_light_mode     BOOLEAN NOT NULL DEFAULT false,
  reverify_required   BOOLEAN NOT NULL DEFAULT false,
  ghost_mode_until    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (vibe IN ('chat', 'connect', 'ignite'))
);
CREATE INDEX IF NOT EXISTS khuloh_profiles_vibe_idx ON khuloh_profiles(vibe);
`;

registerExtraSchema(KHULOH_PROFILE_SCHEMA_SQL);

function nowIso() { return new Date().toISOString(); }

function normalizeUsername(value) {
  const next = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  if (!next || next.length < 2) throw new Error('invalid_username');
  return next.slice(0, 40);
}

function normalizeOptionalText(value, maxLen) {
  if (value == null) return null;
  return String(value).trim().slice(0, maxLen);
}

function normalizeBio(value) {
  return String(value || '').trim().slice(0, 280);
}

function normalizeVibe(value) {
  const next = String(value || 'chat').trim().toLowerCase();
  if (!['chat', 'connect', 'ignite'].includes(next)) throw new Error('invalid_vibe');
  return next;
}

function coerceProfileDoc(userId, doc = {}) {
  const source = doc || {};
  return {
    user_id: userId,
    bio: String(source.bio || ''),
    vibe: normalizeVibe(source.vibe || 'chat'),
    city: source.city == null ? null : String(source.city),
    is_verified: Boolean(source.is_verified),
    is_shadow_banned: Boolean(source.is_shadow_banned),
    data_light_mode: Boolean(source.data_light_mode),
    reverify_required: Boolean(source.reverify_required),
    ghost_mode_until: source.ghost_mode_until || null,
    created_at: source.created_at || nowIso(),
    updated_at: source.updated_at || nowIso(),
  };
}

async function readProfileDoc(userId) {
  if (memUsers.has(String(userId))) {
    return memProfiles.get(String(userId)) || null;
  }
  const db = await getFirestore();
  if (db) {
    const snap = await db.collection('khuloh_profiles').doc(String(userId)).get();
    return snap.exists ? coerceProfileDoc(userId, snap.data()) : null;
  }

  if ((process.env.STORAGE_BACKEND || 'postgres') === 'postgres') {
    const { rows } = await pool.query(
      `SELECT user_id, bio, vibe, city, is_verified, is_shadow_banned,
              data_light_mode, reverify_required,
              ghost_mode_until AS "ghost_mode_until",
              created_at AS "created_at", updated_at AS "updated_at"
         FROM khuloh_profiles
        WHERE user_id = $1`,
      [String(userId)],
    );
    return rows[0] || null;
  }

  return memProfiles.get(String(userId)) || null;
}

async function writeProfileDoc(userId, changes) {
  if (memUsers.has(String(userId))) {
    const next = {
      ...coerceProfileDoc(userId, memProfiles.get(String(userId)) || null),
      ...changes,
      updated_at: nowIso(),
    };
    memProfiles.set(String(userId), next);
    return next;
  }
  const db = await getFirestore();
  const next = {
    ...coerceProfileDoc(userId, await readProfileDoc(userId)),
    ...changes,
    updated_at: nowIso(),
  };

  if (db) {
    await db.collection('khuloh_profiles').doc(String(userId)).set(next, { merge: true });
    return next;
  }

  if ((process.env.STORAGE_BACKEND || 'postgres') === 'postgres') {
    const { rows } = await pool.query(
      `INSERT INTO khuloh_profiles (
         user_id, bio, vibe, city, is_verified, is_shadow_banned,
         data_light_mode, reverify_required, ghost_mode_until, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (user_id) DO UPDATE SET
         bio = EXCLUDED.bio,
         vibe = EXCLUDED.vibe,
         city = EXCLUDED.city,
         is_verified = EXCLUDED.is_verified,
         is_shadow_banned = EXCLUDED.is_shadow_banned,
         data_light_mode = EXCLUDED.data_light_mode,
         reverify_required = EXCLUDED.reverify_required,
         ghost_mode_until = EXCLUDED.ghost_mode_until,
         updated_at = EXCLUDED.updated_at
       RETURNING user_id, bio, vibe, city, is_verified, is_shadow_banned,
                 data_light_mode, reverify_required,
                 ghost_mode_until AS "ghost_mode_until",
                 created_at AS "created_at", updated_at AS "updated_at"`,
      [
        String(userId),
        next.bio,
        next.vibe,
        next.city,
        next.is_verified,
        next.is_shadow_banned,
        next.data_light_mode,
        next.reverify_required,
        next.ghost_mode_until,
        next.created_at,
        next.updated_at,
      ],
    );
    return rows[0];
  }

  memProfiles.set(String(userId), next);
  return next;
}

async function updateUsername(userId, username) {
  const next = normalizeUsername(username);
  if (memUsers.has(String(userId))) {
    memUsers.set(String(userId), {
      ...memUsers.get(String(userId)),
      username: next,
    });
    return next;
  }
  const db = await getFirestore();
  if (db) {
    const ref = db.collection('users').doc(String(userId));
    const snap = await ref.get();
    if (!snap.exists) throw new Error('user_not_found');
    const existing = await db.collection('users').where('username', '==', next).limit(1).get();
    if (!existing.empty && existing.docs[0].id !== String(userId)) throw new Error('username_taken');
    await ref.set({ username: next, updatedAt: nowIso() }, { merge: true });
    return next;
  }

  if ((process.env.STORAGE_BACKEND || 'postgres') === 'postgres') {
    try {
      await pool.query(`UPDATE users SET username = $2 WHERE id = $1`, [String(userId), next]);
      return next;
    } catch (error) {
      if (String(error?.code) === '23505') throw new Error('username_taken');
      throw error;
    }
  }

  const existing = await storage.users.findUserById(String(userId));
  if (!existing) throw new Error('user_not_found');
  return next;
}

async function findBaseUser(userId) {
  if (memUsers.has(String(userId))) return memUsers.get(String(userId));
  const user = await storage.users.findUserById(String(userId));
  if (user) return user;

  const db = await getFirestore();
  if (!db) return null;
  const snap = await db.collection('users').doc(String(userId)).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    id: String(userId),
    username: data.username || null,
    displayName: data.displayName || data.username || null,
    avatarUrl: data.avatarUrl || null,
    phone: data.phone || null,
  };
}

export async function getProfile(userId) {
  const [user, profileDoc, trust, vibePoints] = await Promise.all([
    findBaseUser(userId),
    readProfileDoc(userId),
    computeTrustScore(userId),
    balance(userId),
  ]);
  if (!user) return null;

  return {
    id: user.id,
    phone: user.phone || '',
    username: user.username || null,
    display_name: user.displayName || user.username || null,
    bio: profileDoc?.bio || '',
    trust_score: trust.score,
    trust_tier: trust.tier,
    is_verified: Boolean(profileDoc?.is_verified),
    is_shadow_banned: Boolean(profileDoc?.is_shadow_banned),
    avatar_url: user.avatarUrl || null,
    vibe: profileDoc?.vibe || 'chat',
    vibe_points: vibePoints,
    data_light_mode: Boolean(profileDoc?.data_light_mode),
    reverify_required: Boolean(profileDoc?.reverify_required),
    ghost_mode_until: profileDoc?.ghost_mode_until || null,
    city: profileDoc?.city || null,
    created_at: profileDoc?.created_at || null,
    updated_at: profileDoc?.updated_at || null,
  };
}

export async function updateOwnProfile(userId, { username, bio, vibe, city, dataLightMode } = {}) {
  const current = await getProfile(userId);
  if (!current) throw new Error('user_not_found');

  if (username !== undefined) {
    await updateUsername(userId, username);
  }

  const profileDoc = await writeProfileDoc(userId, {
    bio: bio !== undefined ? normalizeBio(bio) : current.bio,
    vibe: vibe !== undefined ? normalizeVibe(vibe) : current.vibe,
    city: city !== undefined ? normalizeOptionalText(city, 64) : current.city,
    data_light_mode: dataLightMode !== undefined ? Boolean(dataLightMode) : current.data_light_mode,
    is_verified: current.is_verified,
    is_shadow_banned: current.is_shadow_banned,
    reverify_required: current.reverify_required,
    ghost_mode_until: current.ghost_mode_until,
    created_at: current.created_at || nowIso(),
  });

  const refreshed = await getProfile(userId);
  return refreshed || {
    ...current,
    username: username !== undefined ? normalizeUsername(username) : current.username,
    bio: profileDoc.bio,
    vibe: profileDoc.vibe,
    city: profileDoc.city,
    data_light_mode: profileDoc.data_light_mode,
    updated_at: profileDoc.updated_at,
  };
}

export function _resetKhulohProfiles() {
  memProfiles.clear();
  memUsers.clear();
}

export function _seedKhulohProfileUser(user) {
  memUsers.set(String(user.id), {
    id: String(user.id),
    username: user.username || null,
    displayName: user.displayName || user.username || null,
    avatarUrl: user.avatarUrl || null,
    phone: user.phone || '',
  });
}

export function attachKhulohProfileRoutes(app, requireAuth) {
  app.get('/api/khuloh/profile/me', requireAuth, async (req, res) => {
    try {
      const profile = await getProfile(req.user.id);
      if (!profile) return res.status(404).json({ error: 'user_not_found' });
      res.json({ profile });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/khuloh/profile/me', requireAuth, async (req, res) => {
    try {
      const profile = await updateOwnProfile(req.user.id, {
        username: req.body?.username,
        bio: req.body?.bio,
        vibe: req.body?.vibe,
        city: req.body?.city,
        dataLightMode: req.body?.dataLightMode,
      });
      res.json({ profile });
    } catch (err) {
      const status = err.message === 'user_not_found' ? 404
        : err.message === 'username_taken' || err.message === 'invalid_username' || err.message === 'invalid_vibe' ? 400
        : 500;
      res.status(status).json({ error: err.message });
    }
  });

  app.get('/api/khuloh/profile/:uid', requireAuth, async (req, res) => {
    try {
      const profile = await getProfile(req.params.uid);
      if (!profile) return res.status(404).json({ error: 'user_not_found' });
      res.json({
        profile: {
          id: profile.id,
          username: profile.username,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
          vibe: profile.vibe,
          trust_score: profile.trust_score,
          trust_tier: profile.trust_tier,
          is_verified: profile.is_verified,
          is_shadow_banned: profile.is_shadow_banned,
          city: profile.city,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}