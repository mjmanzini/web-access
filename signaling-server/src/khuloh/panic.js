/**
 * khuloh/panic.js — Phase 7 Panic Check-in.
 *
 * Stores up to 3 panic contacts per user, encrypted at rest with AES-256-GCM
 * using KHULOH_KMS_KEY (32-byte hex). When triggered, fans out notifications
 * via SMTP (always) and an optional security webhook (POST JSON).
 *
 * Storage: Firestore `khuloh_panic_contacts` (encrypted blob),
 * `khuloh_panic_events` (audit log).
 *
 * REST:
 *   GET   /api/khuloh/panic/contacts                list (decrypted, owner only)
 *   PUT   /api/khuloh/panic/contacts                replace whole list
 *   POST  /api/khuloh/panic/trigger                 manual trigger
 */
import crypto from 'node:crypto';
import { getFirestore } from './firestore.js';
import { sendMail } from '../email/mailer.js';
import { sendSms } from './sms.js';
import { logEvent } from '../db.js';

const MAX_CONTACTS = 3;
const TRIGGER_RATE_LIMIT_MS = 20 * 60 * 1000; // 3 / hour ~= 1 / 20min
const memContacts = new Map();
const memTriggers = new Map(); // uid -> [ts]

function nowIso() { return new Date().toISOString(); }

function getKey() {
  const hex = process.env.KHULOH_KMS_KEY;
  if (!hex) return null;
  try {
    const buf = Buffer.from(hex, 'hex');
    if (buf.length !== 32) return null;
    return buf;
  } catch { return null; }
}

function encrypt(value) {
  const key = getKey();
  const text = JSON.stringify(value);
  if (!key) {
    // Dev fallback: base64 — never deploy to prod without KHULOH_KMS_KEY.
    return { v: 0, c: Buffer.from(text, 'utf8').toString('base64') };
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString('base64'),
    c: enc.toString('base64'),
    t: tag.toString('base64'),
  };
}

function decrypt(blob) {
  if (!blob) return [];
  if (blob.v === 0) {
    try { return JSON.parse(Buffer.from(blob.c, 'base64').toString('utf8')); } catch { return []; }
  }
  const key = getKey();
  if (!key) return [];
  try {
    const iv  = Buffer.from(blob.iv, 'base64');
    const ct  = Buffer.from(blob.c, 'base64');
    const tag = Buffer.from(blob.t, 'base64');
    const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(tag);
    const out = Buffer.concat([dec.update(ct), dec.final()]);
    return JSON.parse(out.toString('utf8'));
  } catch { return []; }
}

function sanitiseContacts(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_CONTACTS)
    .map((c) => ({
      name:  String(c?.name || '').trim().slice(0, 80),
      phone: c?.phone ? String(c.phone).trim().slice(0, 32) : null,
      email: c?.email ? String(c.email).trim().slice(0, 200) : null,
    }))
    .filter((c) => c.name && (c.phone || c.email));
}

export async function getContacts(uid) {
  const db = await getFirestore();
  if (!db) return decrypt(memContacts.get(uid) || null);
  const snap = await db.collection('khuloh_panic_contacts').doc(uid).get();
  if (!snap.exists) return [];
  return decrypt(snap.data().blob);
}

export async function setContacts(uid, contacts) {
  const clean = sanitiseContacts(contacts);
  const blob = encrypt(clean);
  const doc = { uid, blob, updated_at: nowIso() };
  const db = await getFirestore();
  if (!db) { memContacts.set(uid, blob); return clean; }
  await db.collection('khuloh_panic_contacts').doc(uid).set(doc, { merge: true });
  return clean;
}

function rateLimited(uid) {
  const now = Date.now();
  const arr = (memTriggers.get(uid) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (arr.length >= 3) return true;
  arr.push(now);
  memTriggers.set(uid, arr);
  return false;
}

async function notifyContacts({ uid, userLabel, contacts, source, meetupId, note }) {
  const subject = `Khuloh PANIC alert from ${userLabel}`;
  const lines = [
    `${userLabel} has triggered a Khuloh panic alert.`,
    source === 'meetup' && meetupId ? `Meetup: ${meetupId}` : null,
    note ? `Note: ${String(note).slice(0, 500)}` : null,
    `Triggered at: ${nowIso()}`,
    '',
    'In a real emergency in South Africa, dial 10111 (SAPS) or 112 from any mobile network.',
  ].filter(Boolean);
  const text = lines.join('\n');
  const html = `<pre style="font:14px/1.5 sans-serif">${lines.map((l) =>
    String(l).replace(/[<&>]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] || c)),
  ).join('\n')}</pre>`;

  const sends = contacts
    .filter((c) => c.email)
    .map((c) => sendMail({ to: c.email, subject, text, html }).catch(() => false));

  await Promise.allSettled(sends);

  // SMS fan-out via pluggable adapter (twilio | clickatell | log).
  const smsBody = `KHULOH ALERT: ${userLabel} triggered a panic check-in at ${nowIso()}.`
    + (source === 'meetup' && meetupId ? ` Meetup ${meetupId}.` : '')
    + ' In a real emergency call 10111 or 112.';
  for (const c of contacts) {
    if (!c.phone) continue;
    sendSms({ to: c.phone, body: smsBody })
      .then((r) => {
        logEvent(r.sent ? 'khuloh_panic_sms_sent' : 'khuloh_panic_sms_failed', {
          userId: uid,
          payload: { provider: r.provider, to_last4: c.phone.slice(-4), error: r.error || null, source },
        });
      })
      .catch(() => {});
  }

  const webhook = process.env.KHULOH_SECURITY_WEBHOOK_URL;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, userLabel, source, meetupId, note, ts: nowIso(), contacts: contacts.length }),
      });
    } catch (err) {
      logEvent('khuloh_panic_webhook_failed', { userId: uid, payload: { error: err.message } });
    }
  }
}

async function recordEvent({ uid, source, meetupId, note, contacts }) {
  const db = await getFirestore();
  const event = {
    id: crypto.randomUUID(),
    uid,
    source: source || 'manual',
    meetup_id: meetupId || null,
    note: note ? String(note).slice(0, 1000) : null,
    contacts_notified: contacts.length,
    created_at: nowIso(),
  };
  if (db) await db.collection('khuloh_panic_events').doc(event.id).set(event);
  logEvent('khuloh_panic_triggered', { userId: uid, payload: event });
  return event;
}

/**
 * Programmatic trigger — used by meetups.markPanic and the REST handler.
 */
export async function triggerPanic({ uid, userLabel, source = 'manual', meetupId = null, note = null }) {
  if (!uid) throw new Error('uid_required');
  if (rateLimited(uid)) throw Object.assign(new Error('rate_limited'), { code: 'rate_limited' });
  const contacts = await getContacts(uid);
  await notifyContacts({ uid, userLabel: userLabel || uid.slice(0, 6), contacts, source, meetupId, note });
  return recordEvent({ uid, source, meetupId, note, contacts });
}

export function _resetPanicState() {
  memContacts.clear();
  memTriggers.clear();
}

export function attachPanicRoutes(app, requireAuth) {
  app.get('/api/khuloh/panic/contacts', requireAuth, async (req, res) => {
    try {
      const contacts = await getContacts(req.user.id);
      res.json({ contacts });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/khuloh/panic/contacts', requireAuth, async (req, res) => {
    try {
      const contacts = await setContacts(req.user.id, req.body?.contacts || []);
      res.json({ contacts });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/khuloh/panic/trigger', requireAuth, async (req, res) => {
    try {
      const event = await triggerPanic({
        uid: req.user.id,
        userLabel: req.user.displayName || req.user.username || req.user.id,
        source: 'manual',
        note: req.body?.note,
      });
      res.json({ ok: true, event });
    } catch (err) {
      const status = err.code === 'rate_limited' ? 429 : 400;
      res.status(status).json({ error: err.message });
    }
  });
}
