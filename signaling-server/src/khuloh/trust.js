/**
 * khuloh/trust.js — Trust score + Guardian tier (Phase 6).
 *
 * Score is a small deterministic function of a user's lifetime Vibe ledger.
 *
 *   POSITIVE          weight
 *   ----------------  ------
 *   safe_meetup       +20  (capped at 10 contributions = +200)
 *   report_upheld     +15
 *   daily_login       +1   (capped at 60 = +60)
 *   guardian_bonus    +10
 *   manual_grant      +5
 *
 *   NEGATIVE          weight
 *   ----------------  ------
 *   shout (debit)     -1   per shout (max -50)
 *   ghost_mode        0    neutral
 *   refund            0    neutral
 *
 * Tiers:
 *   new        score <  50
 *   regular    50 ≤ score < 200
 *   trusted    200 ≤ score < 500
 *   guardian   score ≥ 500
 *
 * Guardians can mute users in a zone for up to 60 minutes.
 */
import { getFirestore } from './firestore.js';

const COUNT_CAPS = { safe_meetup: 10, daily_login: 60, shout: 50 };
const WEIGHTS    = {
  safe_meetup:    20,
  report_upheld:  15,
  daily_login:    1,
  guardian_bonus: 10,
  manual_grant:   5,
  shout:          -1,
};

export function tierFor(score) {
  if (score >= 500) return 'guardian';
  if (score >= 200) return 'trusted';
  if (score >=  50) return 'regular';
  return 'new';
}

export function isGuardian(score) {
  return tierFor(score) === 'guardian';
}

/**
 * Scan the entire ledger for a user and compute their score.
 * Cheap in Firestore for small ledgers; for very active users we cap reads.
 */
export async function computeTrustScore(uid) {
  const db = await getFirestore();
  if (!db) return { uid, score: 0, tier: 'new', counts: {} };

  const snap = await db.collection('khuloh_vibe_ledger')
    .where('uid', '==', uid)
    .limit(2000)
    .get();

  const counts = {};
  for (const doc of snap.docs) {
    const reason = doc.data().reason;
    counts[reason] = (counts[reason] || 0) + 1;
  }

  let score = 0;
  for (const [reason, weight] of Object.entries(WEIGHTS)) {
    const n = counts[reason] || 0;
    const capped = COUNT_CAPS[reason] ? Math.min(n, COUNT_CAPS[reason]) : n;
    score += capped * weight;
  }
  score = Math.max(0, Math.round(score));
  return { uid, score, tier: tierFor(score), counts };
}

export function attachTrustRoutes(app, requireAuth) {
  app.get('/api/khuloh/trust/me', requireAuth, async (req, res) => {
    try {
      const result = await computeTrustScore(req.user.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Public view: tier only, never raw counts.
  app.get('/api/khuloh/trust/:uid', requireAuth, async (req, res) => {
    try {
      const { score, tier } = await computeTrustScore(req.params.uid);
      res.json({ uid: req.params.uid, score, tier });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
