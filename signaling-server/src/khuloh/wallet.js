/**
 * khuloh/wallet.js — Vibe Points wallet (Phase 6).
 *
 * Append-only ledger in Firestore at `khuloh_vibe_ledger` plus a
 * denormalised `khuloh_vibe_points` field on the `users` document.
 * Mutations run inside a Firestore transaction so the denormalised
 * value can never drift from SUM(deltas).
 *
 * This module is a no-op (returns balance=0, ledger=[]) when Firebase
 * isn't configured, so dev/local Postgres deployments stay green.
 *
 * NOTE: experimental — see docs/khuloh/IMPLEMENTATION-PLAN.md.
 */
import crypto from 'node:crypto';
import { getFirestore } from './firestore.js';

function ledgerCollection(db) { return db.collection('khuloh_vibe_ledger'); }
function userDoc(db, uid)     { return db.collection('users').doc(uid); }

const VALID_REASONS = new Set([
  'daily_login',
  'safe_meetup',
  'report_upheld',
  'shout',
  'ghost_mode',
  'guardian_bonus',
  'refund',
  'manual_grant',
]);

function assertReason(reason) {
  if (!VALID_REASONS.has(reason)) {
    throw new Error(`khuloh_wallet: unknown reason "${reason}"`);
  }
}

function nowIso() { return new Date().toISOString(); }

/**
 * Apply a signed delta atomically.
 * @returns {Promise<{ id:string, balance:number, delta:number, reason:string }>}
 */
export async function applyDelta(uid, delta, reason, ref = null) {
  if (!uid) throw new Error('khuloh_wallet: uid required');
  if (!Number.isInteger(delta)) throw new Error('khuloh_wallet: integer delta required');
  assertReason(reason);

  const db = await getFirestore();
  if (!db) return { id: 'noop', balance: 0, delta, reason, disabled: true };

  const id = crypto.randomUUID();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userDoc(db, uid));
    const current = Number(snap.exists && snap.data()?.khuloh_vibe_points) || 0;
    const next = current + delta;
    if (next < 0) {
      throw Object.assign(new Error('insufficient'), { code: 'insufficient' });
    }
    tx.set(
      userDoc(db, uid),
      { khuloh_vibe_points: next, khuloh_vibe_updated_at: nowIso() },
      { merge: true },
    );
    tx.set(ledgerCollection(db).doc(id), {
      id, uid, delta, reason, ref, created_at: nowIso(),
    });
    return { id, balance: next, delta, reason };
  });
}

export const credit = (uid, delta, reason, ref) => {
  if (delta <= 0) throw new Error('khuloh_wallet: credit requires positive delta');
  return applyDelta(uid, delta, reason, ref);
};

export const debit = (uid, delta, reason, ref) => {
  if (delta <= 0) throw new Error('khuloh_wallet: debit requires positive delta');
  return applyDelta(uid, -delta, reason, ref);
};

export async function balance(uid) {
  const db = await getFirestore();
  if (!db) return 0;
  const snap = await userDoc(db, uid).get();
  return Number(snap.exists && snap.data()?.khuloh_vibe_points) || 0;
}

/** Delta sync: rows for `uid` strictly after `sinceIso`, oldest first, capped. */
export async function ledgerSince(uid, sinceIso = null, limit = 100) {
  const db = await getFirestore();
  if (!db) return [];
  const cap = Math.min(Math.max(1, Number(limit) | 0 || 100), 500);
  let q = ledgerCollection(db).where('uid', '==', uid);
  if (sinceIso) q = q.where('created_at', '>', sinceIso);
  q = q.orderBy('created_at', 'asc').limit(cap);
  const rows = await q.get();
  return rows.docs.map((d) => d.data());
}

/** Idempotent daily login credit (UTC day key). */
export async function creditDailyLogin(uid) {
  const db = await getFirestore();
  if (!db) return { skipped: true };
  const today = new Date().toISOString().slice(0, 10);
  return db.runTransaction(async (tx) => {
    const ref = userDoc(db, uid);
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    if (data?.khuloh_last_login_credit_day === today) {
      return { skipped: true, balance: Number(data.khuloh_vibe_points) || 0 };
    }
    const current = Number(data?.khuloh_vibe_points) || 0;
    const next = current + 10;
    tx.set(ref, {
      khuloh_vibe_points: next,
      khuloh_last_login_credit_day: today,
      khuloh_vibe_updated_at: nowIso(),
    }, { merge: true });
    const id = crypto.randomUUID();
    tx.set(ledgerCollection(db).doc(id), {
      id, uid, delta: 10, reason: 'daily_login', ref: today, created_at: nowIso(),
    });
    return { skipped: false, credited: 10, balance: next };
  });
}

export const COSTS = Object.freeze({
  shout: 20,
  ghost_mode: 100,
});
