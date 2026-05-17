/**
 * khuloh/wire.ts — client mirror of signaling-server/src/khuloh/wire.js.
 * Keep in sync with the server schema (same field tags).
 */

const STRING = 2;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

function writeVarint(out: number[], value: number) {
  let v = value >>> 0;
  while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
  out.push(v & 0x7f);
}

function writeString(out: number[], fieldNum: number, value: string | null | undefined) {
  if (value == null) return;
  const s = String(value);
  if (!s) return;
  const bytes = enc.encode(s);
  writeVarint(out, (fieldNum << 3) | STRING);
  writeVarint(out, bytes.length);
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
}

function readVarint(view: Uint8Array, state: { pos: number }): number {
  let result = 0; let shift = 0; let byte = 0;
  do {
    if (state.pos >= view.length) throw new Error('varint_truncated');
    byte = view[state.pos++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return result >>> 0;
}

function readString(view: Uint8Array, state: { pos: number }): string {
  const len = readVarint(view, state);
  if (state.pos + len > view.length) throw new Error('string_truncated');
  const s = dec.decode(view.subarray(state.pos, state.pos + len));
  state.pos += len;
  return s;
}

function decodeFields(buf: ArrayBuffer | Uint8Array): Record<number, string> {
  const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const state = { pos: 0 };
  const out: Record<number, string> = {};
  while (state.pos < view.length) {
    const tag = readVarint(view, state);
    const field = tag >>> 3;
    const wire  = tag & 7;
    if (wire !== STRING) throw new Error(`unsupported_wire_type:${wire}`);
    out[field] = readString(view, state);
  }
  return out;
}

export interface WireZoneMessage {
  id: string;
  zoneId: string;
  fromId: string;
  fromHandle: string | null;
  body: string;
  ts: string;
}

export interface WireShout {
  zoneId: string;
  fromId: string;
  fromHandle: string | null;
  body: string;
  ts: string;
}

export function encodeZoneMessage(msg: WireZoneMessage): Uint8Array {
  const out: number[] = [];
  writeString(out, 1, msg.id);
  writeString(out, 2, msg.zoneId);
  writeString(out, 3, msg.fromId);
  writeString(out, 4, msg.fromHandle);
  writeString(out, 5, msg.body);
  writeString(out, 6, msg.ts);
  return Uint8Array.from(out);
}

export function decodeZoneMessage(buf: ArrayBuffer | Uint8Array): WireZoneMessage {
  const f = decodeFields(buf);
  return {
    id:         f[1] || '',
    zoneId:     f[2] || '',
    fromId:     f[3] || '',
    fromHandle: f[4] || null,
    body:       f[5] || '',
    ts:         f[6] || '',
  };
}

export function encodeShout(s: WireShout): Uint8Array {
  const out: number[] = [];
  writeString(out, 1, s.zoneId);
  writeString(out, 2, s.fromId);
  writeString(out, 3, s.fromHandle);
  writeString(out, 4, s.body);
  writeString(out, 5, s.ts);
  return Uint8Array.from(out);
}

export function decodeShout(buf: ArrayBuffer | Uint8Array): WireShout {
  const f = decodeFields(buf);
  return {
    zoneId:     f[1] || '',
    fromId:     f[2] || '',
    fromHandle: f[3] || null,
    body:       f[4] || '',
    ts:         f[5] || '',
  };
}
