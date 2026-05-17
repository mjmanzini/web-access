/**
 * khuloh/socket.js — Socket.IO `/khuloh` namespace (Phase 6).
 *
 * Events:
 *   client -> 'wallet_sync' { sinceIso? }            ack: { balance, ledger }
 *   client -> 'shout'       { zoneId, body }          ack: { ok, balance? } + broadcast
 *   client -> 'ghost_mode'  { minutes? }              ack: { ok, balance, until }
 *
 * Reuses the same socketAuth used by the chat namespace.
 */
import { socketAuth } from '../auth/sessions.js';
import { logEvent } from '../db.js';
import { COSTS, balance, debit, ledgerSince, creditDailyLogin } from './wallet.js';
import { evaluateMessage as scamShieldEvaluate, buildBlockNotice } from './scam-shield.js';
import { registerZoneSocket } from './zones.js';
import { computeTrustScore, isGuardian } from './trust.js';
import { muteInZone, unmuteInZone, isMutedInZone } from './moderation.js';
import { encodeShout } from './wire.js';
import { addPresence, removePresence, removeSocket, listPresence } from './presence.js';

const GHOST_MIN_MINUTES = 5;
const GHOST_MAX_MINUTES = 60;
const SHOUT_MAX_BODY = 280;

export function attachKhulohSignaling(io, users) {
  const nsp = io.of('/khuloh');
  nsp.use(socketAuth(users));

  nsp.on('connection', async (socket) => {
    const me = socket.data.user;
    socket.join(`user:${me.id}`);
    logEvent('khuloh_connected', { userId: me.id });

    creditDailyLogin(me.id).catch((err) => {
      console.warn('[khuloh] daily login credit failed:', err.message);
    });

    socket.on('wallet_sync', async ({ sinceIso } = {}, ack) => {
      try {
        const [bal, ledger] = await Promise.all([
          balance(me.id),
          ledgerSince(me.id, sinceIso || null),
        ]);
        ack?.({ ok: true, balance: bal, ledger });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('shout', async ({ zoneId, body } = {}, ack) => {
      try {
        if (!zoneId || typeof zoneId !== 'string') throw new Error('zone_required');
        const text = String(body || '').trim().slice(0, SHOUT_MAX_BODY);
        if (!text) throw new Error('body_required');
        if (await isMutedInZone(zoneId, me.id)) {
          ack?.({ ok: false, error: 'muted', notice: 'A Guardian has muted you in this Zone.' });
          return;
        }
        const verdict = scamShieldEvaluate(text);
        if (verdict.action === 'block') {
          logEvent('khuloh_scam_blocked', { userId: me.id, zoneId, reasons: verdict.reasons, kind: 'shout' });
          ack?.({ ok: false, error: 'scam_blocked', notice: buildBlockNotice() });
          return;
        }
        if (verdict.action === 'flag') {
          logEvent('khuloh_scam_flagged', { userId: me.id, zoneId, reasons: verdict.reasons, kind: 'shout' });
        }
        const result = await debit(me.id, COSTS.shout, 'shout', zoneId);
        const payload = {
          zoneId,
          fromId: me.id,
          fromHandle: me.username || me.displayName || null,
          body: text,
          ts: new Date().toISOString(),
        };
        nsp.to(`zone:${zoneId}`).emit('shout', payload);
        // Phase 8: data-lite mirror for opted-in clients (binary).
        nsp.to(`zone:${zoneId}`).emit('shout.b', encodeShout(payload));
        ack?.({ ok: true, balance: result.balance });
      } catch (err) {
        ack?.({ ok: false, error: err.code || err.message });
      }
    });

    socket.on('ghost_mode', async ({ minutes } = {}, ack) => {
      try {
        const m = Math.min(GHOST_MAX_MINUTES, Math.max(GHOST_MIN_MINUTES, Number(minutes) || 30));
        const result = await debit(me.id, COSTS.ghost_mode, 'ghost_mode');
        const until = new Date(Date.now() + m * 60_000).toISOString();
        ack?.({ ok: true, balance: result.balance, until, minutes: m });
      } catch (err) {
        ack?.({ ok: false, error: err.code || err.message });
      }
    });

    socket.on('zone:join', ({ zoneId } = {}) => {
      if (typeof zoneId !== 'string' || !zoneId) return;
      socket.join(`zone:${zoneId}`);
      const r = addPresence({
        zoneId,
        socketId: socket.id,
        uid: me.id,
        handle: me.username || me.displayName || null,
      });
      if (r?.changed) {
        const snap = listPresence(zoneId);
        nsp.to(`zone:${zoneId}`).emit('zone:presence', snap);
      }
    });
    socket.on('zone:leave', ({ zoneId } = {}) => {
      if (typeof zoneId !== 'string' || !zoneId) return;
      socket.leave(`zone:${zoneId}`);
      const r = removePresence({ zoneId, socketId: socket.id, uid: me.id });
      if (r?.changed) {
        nsp.to(`zone:${zoneId}`).emit('zone:presence', listPresence(zoneId));
      }
    });

    // Lightweight typing indicator. Server-side throttling not required:
    // the client debounces sends to ~1/sec and auto-stops after 3s idle.
    socket.on('zone:typing', ({ zoneId, typing } = {}) => {
      if (typeof zoneId !== 'string' || !zoneId) return;
      socket.to(`zone:${zoneId}`).emit('zone:typing', {
        zoneId,
        uid: me.id,
        handle: me.username || me.displayName || null,
        typing: !!typing,
        ts: new Date().toISOString(),
      });
    });

    socket.on('zone:presence:list', ({ zoneId } = {}, ack) => {
      if (typeof zoneId !== 'string' || !zoneId) return ack?.({ ok: false, error: 'zone_required' });
      ack?.({ ok: true, ...listPresence(zoneId) });
    });

    socket.on('disconnect', () => {
      const dropped = removeSocket(socket.id);
      for (const zoneId of dropped) {
        nsp.to(`zone:${zoneId}`).emit('zone:presence', listPresence(zoneId));
      }
      logEvent('khuloh_disconnected', { userId: me.id });
    });

    // Phase 8 opt-in handshake. Lets the client confirm wire-codec support;
    // the server always emits both events (`shout`/`shout.b`, `zone:msg`/
    // `zone:msg.b`) so legacy clients keep working.
    socket.on('wire:binary', (_payload, ack) => {
      ack?.({ ok: true, version: 1, events: ['zone:msg.b', 'shout.b'] });
    });

    // ---- Guardian moderation ----

    socket.on('trust:me', async (_payload, ack) => {
      try {
        const t = await computeTrustScore(me.id);
        ack?.({ ok: true, ...t });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('zone:mute', async ({ zoneId, targetUid, minutes, reason } = {}, ack) => {
      try {
        if (!zoneId || !targetUid) throw new Error('zone_and_target_required');
        const t = await computeTrustScore(me.id);
        if (!isGuardian(t.score)) {
          ack?.({ ok: false, error: 'not_guardian' });
          return;
        }
        const mute = await muteInZone({ zoneId, targetUid, byUid: me.id, minutes, reason });
        logEvent('khuloh_zone_mute', { userId: me.id, payload: { zoneId, targetUid, minutes: mute.minutes, reason } });
        nsp.to(`zone:${zoneId}`).emit('zone:mute', mute);
        ack?.({ ok: true, mute });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('zone:unmute', async ({ zoneId, targetUid } = {}, ack) => {
      try {
        const t = await computeTrustScore(me.id);
        if (!isGuardian(t.score)) {
          ack?.({ ok: false, error: 'not_guardian' });
          return;
        }
        await unmuteInZone({ zoneId, targetUid });
        logEvent('khuloh_zone_unmute', { userId: me.id, payload: { zoneId, targetUid } });
        nsp.to(`zone:${zoneId}`).emit('zone:unmute', { zoneId, targetUid });
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    registerZoneSocket(nsp, socket, me);
  });

  return nsp;
}
