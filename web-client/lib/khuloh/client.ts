/**
 * Khuloh client — Vibe Points wallet + Zone shouts.
 * Pairs with signaling-server `khuloh/socket.js` on the `/khuloh` namespace.
 */
import { io, Socket } from 'socket.io-client';
import { decodeShout, decodeZoneMessage } from './wire';

export interface LedgerEntry {
  id: string;
  uid: string;
  delta: number;
  reason:
    | 'daily_login' | 'safe_meetup' | 'report_upheld' | 'shout'
    | 'ghost_mode' | 'guardian_bonus' | 'refund' | 'manual_grant';
  ref?: string | null;
  created_at: string;
}

export interface ShoutEvent {
  zoneId: string;
  fromId: string;
  fromHandle: string | null;
  body: string;
  ts: string;
}

export interface ZoneMessage {
  id: string;
  zoneId: string;
  fromId: string;
  fromHandle: string | null;
  body: string;
  ts: string;
}

export interface Zone {
  id: string;
  name: string;
  city: string;
  topic: string | null;
  member_count: number;
  is_official: boolean;
  created_at: string;
}

export interface PresenceMember {
  uid: string;
  handle: string | null;
}

export interface PresenceSnapshot {
  zoneId: string;
  count: number;
  members: PresenceMember[];
}

export interface TypingEvent {
  zoneId: string;
  uid: string;
  handle: string | null;
  typing: boolean;
  ts: string;
}

type Ack<T> = (response: T) => void;

export class KhulohClient {
  private sock: Socket;
  private shoutListeners = new Set<(s: ShoutEvent) => void>();
  private zoneMsgListeners = new Set<(m: ZoneMessage) => void>();
  private binary = false;

  constructor(url: string, token: string) {
    const base = url.replace(/\/$/, '');
    this.sock = io(`${base}/khuloh`, {
      auth: { token },
      transports: ['websocket'],
      withCredentials: true,
    });
    this.sock.on('shout',    (s: ShoutEvent)   => { if (!this.binary) this.shoutListeners.forEach((f) => f(s)); });
    this.sock.on('zone:msg', (m: ZoneMessage) => { if (!this.binary) this.zoneMsgListeners.forEach((f) => f(m)); });
    this.sock.on('shout.b',    (buf: ArrayBuffer | Uint8Array) => {
      if (!this.binary) return;
      try { this.shoutListeners.forEach((f) => f(decodeShout(buf) as ShoutEvent)); } catch { /* ignore malformed */ }
    });
    this.sock.on('zone:msg.b', (buf: ArrayBuffer | Uint8Array) => {
      if (!this.binary) return;
      try { this.zoneMsgListeners.forEach((f) => f(decodeZoneMessage(buf) as ZoneMessage)); } catch { /* ignore malformed */ }
    });
  }

  /** Phase 8: opt into the binary wire format. Saves ~35-50% on zone traffic. */
  enableBinaryWire(): Promise<{ version: number; events: string[] }> {
    return this.emitWithAck<{ version: number; events: string[] }>('wire:binary', {})
      .then((res) => { this.binary = true; return res; });
  }

  walletSync(sinceIso?: string): Promise<{ balance: number; ledger: LedgerEntry[] }> {
    return this.emitWithAck('wallet_sync', { sinceIso });
  }

  shout(zoneId: string, body: string): Promise<{ balance?: number }> {
    return this.emitWithAck('shout', { zoneId, body });
  }

  ghostMode(minutes = 30): Promise<{ balance: number; until: string; minutes: number }> {
    return this.emitWithAck('ghost_mode', { minutes });
  }

  sendZoneMessage(zoneId: string, body: string): Promise<{ message: ZoneMessage }> {
    return this.emitWithAck('zone:msg', { zoneId, body });
  }

  joinZone(zoneId: string)  { this.sock.emit('zone:join',  { zoneId }); }
  leaveZone(zoneId: string) { this.sock.emit('zone:leave', { zoneId }); }

  setTyping(zoneId: string, typing: boolean) {
    this.sock.emit('zone:typing', { zoneId, typing });
  }

  listPresence(zoneId: string): Promise<PresenceSnapshot> {
    return this.emitWithAck('zone:presence:list', { zoneId });
  }

  onPresence(fn: (p: PresenceSnapshot) => void) {
    const handler = (p: PresenceSnapshot) => fn(p);
    this.sock.on('zone:presence', handler);
    return () => this.sock.off('zone:presence', handler);
  }

  onTyping(fn: (t: TypingEvent) => void) {
    const handler = (t: TypingEvent) => fn(t);
    this.sock.on('zone:typing', handler);
    return () => this.sock.off('zone:typing', handler);
  }

  myTrust(): Promise<TrustScore & { ok: true }> {
    return this.emitWithAck('trust:me', {});
  }

  muteUserInZone(zoneId: string, targetUid: string, minutes = 10, reason?: string): Promise<{ mute: ZoneMute }> {
    return this.emitWithAck('zone:mute', { zoneId, targetUid, minutes, reason });
  }

  unmuteUserInZone(zoneId: string, targetUid: string): Promise<{ ok: true }> {
    return this.emitWithAck('zone:unmute', { zoneId, targetUid });
  }

  onMute(fn: (m: ZoneMute) => void) {
    const handler = (m: ZoneMute) => fn(m);
    this.sock.on('zone:mute', handler);
    return () => this.sock.off('zone:mute', handler);
  }

  onUnmute(fn: (m: { zoneId: string; targetUid: string }) => void) {
    const handler = (m: { zoneId: string; targetUid: string }) => fn(m);
    this.sock.on('zone:unmute', handler);
    return () => this.sock.off('zone:unmute', handler);
  }

  onShout(fn: (s: ShoutEvent) => void) {
    this.shoutListeners.add(fn);
    return () => this.shoutListeners.delete(fn);
  }

  onZoneMessage(fn: (m: ZoneMessage) => void) {
    this.zoneMsgListeners.add(fn);
    return () => this.zoneMsgListeners.delete(fn);
  }

  close() { this.sock.close(); }

  private emitWithAck<T>(event: string, payload: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      this.sock.emit(event, payload, (ack: { ok: boolean; error?: string; notice?: string } & T) => {
        if (!ack) return reject(new Error('no_ack'));
        if (!ack.ok) {
          const err = new Error(ack.error || 'failed');
          (err as Error & { notice?: string }).notice = ack.notice;
          return reject(err);
        }
        resolve(ack);
      });
    });
  }
}

// REST helpers (use the user's bearer token).
async function authedFetch(url: string, token: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

export async function listZones(baseUrl: string, token: string, city?: string): Promise<Zone[]> {
  const qs = city ? `?city=${encodeURIComponent(city)}` : '';
  const data = await authedFetch(`${baseUrl}/api/khuloh/zones${qs}`, token);
  return data.zones || [];
}

export async function createZone(
  baseUrl: string,
  token: string,
  body: { name: string; city: string; topic?: string },
): Promise<Zone> {
  const data = await authedFetch(`${baseUrl}/api/khuloh/zones`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return data.zone;
}

export async function fetchZoneMessages(baseUrl: string, token: string, zoneId: string, limit = 50): Promise<ZoneMessage[]> {
  const data = await authedFetch(
    `${baseUrl}/api/khuloh/zones/${encodeURIComponent(zoneId)}/messages?limit=${limit}`,
    token,
  );
  return data.messages || [];
}

// ---------- Safe-Spots ----------

export interface SafeSpot {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  address: string | null;
  deal_text: string | null;
  partner_id: string | null;
  active: boolean;
  distance_km?: number;
}

export async function listSafeSpots(
  baseUrl: string,
  token: string,
  opts: { city?: string; lat?: number; lng?: number; radiusKm?: number } = {},
): Promise<SafeSpot[]> {
  const qs = new URLSearchParams();
  if (opts.city) qs.set('city', opts.city);
  if (opts.lat != null) qs.set('lat', String(opts.lat));
  if (opts.lng != null) qs.set('lng', String(opts.lng));
  if (opts.radiusKm != null) qs.set('radiusKm', String(opts.radiusKm));
  const data = await authedFetch(`${baseUrl}/api/khuloh/safe-spots?${qs.toString()}`, token);
  return data.spots || [];
}

// ---------- Meetups ----------

export interface Meetup {
  id: string;
  a_uid: string;
  b_uid: string;
  spot_id: string;
  scheduled_for: string;
  started_at: string | null;
  a_checked_in_at: string | null;
  b_checked_in_at: string | null;
  a_safe_at: string | null;
  b_safe_at: string | null;
  status: 'scheduled' | 'in_progress' | 'safe' | 'missed' | 'panic';
}

export async function scheduleMeetup(
  baseUrl: string, token: string,
  body: { peerUserId: string; spotId: string; scheduledFor?: string },
): Promise<Meetup> {
  const data = await authedFetch(`${baseUrl}/api/khuloh/meetups`, token, {
    method: 'POST', body: JSON.stringify(body),
  });
  return data.meetup;
}

export async function checkInMeetup(
  baseUrl: string, token: string, meetupId: string, lat: number, lng: number,
): Promise<Meetup> {
  const data = await authedFetch(
    `${baseUrl}/api/khuloh/meetups/${encodeURIComponent(meetupId)}/check-in`,
    token,
    { method: 'POST', body: JSON.stringify({ lat, lng }) },
  );
  return data.meetup;
}

export async function markMeetupSafe(baseUrl: string, token: string, meetupId: string): Promise<Meetup> {
  const data = await authedFetch(
    `${baseUrl}/api/khuloh/meetups/${encodeURIComponent(meetupId)}/safe`, token, { method: 'POST', body: '{}' },
  );
  return data.meetup;
}

export async function markMeetupPanic(
  baseUrl: string, token: string, meetupId: string, note?: string,
): Promise<Meetup> {
  const data = await authedFetch(
    `${baseUrl}/api/khuloh/meetups/${encodeURIComponent(meetupId)}/panic`, token,
    { method: 'POST', body: JSON.stringify({ note }) },
  );
  return data.meetup;
}

export async function listMyMeetups(baseUrl: string, token: string): Promise<Meetup[]> {
  const data = await authedFetch(`${baseUrl}/api/khuloh/meetups/mine`, token);
  return data.meetups || [];
}

// ---------- Panic ----------

export interface PanicContact { name: string; phone: string | null; email: string | null }

export async function getPanicContacts(baseUrl: string, token: string): Promise<PanicContact[]> {
  const data = await authedFetch(`${baseUrl}/api/khuloh/panic/contacts`, token);
  return data.contacts || [];
}

export async function setPanicContacts(
  baseUrl: string, token: string, contacts: PanicContact[],
): Promise<PanicContact[]> {
  const data = await authedFetch(`${baseUrl}/api/khuloh/panic/contacts`, token, {
    method: 'PUT', body: JSON.stringify({ contacts }),
  });
  return data.contacts || [];
}

export async function triggerPanic(baseUrl: string, token: string, note?: string): Promise<{ ok: true }> {
  return authedFetch(`${baseUrl}/api/khuloh/panic/trigger`, token, {
    method: 'POST', body: JSON.stringify({ note }),
  });
}

// ---------- Partner QR ----------

export interface PartnerQrVerifyResult {
  ok: true;
  spot: { id: string; name: string; city: string; deal_text: string | null };
  meetup: Meetup | null;
}

export async function verifyPartnerQr(
  baseUrl: string,
  token: string,
  body: { token: string; lat: number; lng: number; meetupId?: string },
): Promise<PartnerQrVerifyResult> {
  return authedFetch(`${baseUrl}/api/khuloh/partner/qr/verify`, token, {
    method: 'POST', body: JSON.stringify(body),
  });
}

/** Parses a `khuloh://safe-spot?d=...` URL (or raw token) into the signed token. */
export function parsePartnerQrPayload(raw: string): string | null {
  if (!raw) return null;
  const m = raw.match(/[?&]d=([^&]+)/);
  if (m) try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  // Plain token of the form base64url.base64url
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw.trim()) ? raw.trim() : null;
}

// ---------- Trust + Guardian moderation ----------

export type TrustTier = 'new' | 'regular' | 'trusted' | 'guardian';

export interface TrustScore {
  uid: string;
  score: number;
  tier: TrustTier;
  counts?: Record<string, number>;
}

export interface ZoneMute {
  zone_id: string;
  target_uid: string;
  by_uid: string;
  reason: string | null;
  minutes: number;
  expires_at: string;
  created_at: string;
}

export async function getMyTrust(baseUrl: string, token: string): Promise<TrustScore> {
  return authedFetch(`${baseUrl}/api/khuloh/trust/me`, token);
}

export async function getUserTrust(baseUrl: string, token: string, uid: string): Promise<TrustScore> {
  return authedFetch(`${baseUrl}/api/khuloh/trust/${encodeURIComponent(uid)}`, token);
}
