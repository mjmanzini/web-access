/**
 * khuloh/wire.js — Phase 8 "data-lite" binary wire format.
 *
 * Hand-rolled, dependency-free, protobuf-compatible subset:
 *   - varint  (unsigned LEB128)
 *   - length-delimited UTF-8 strings (wire type 2)
 *
 * Tag layout = (field_number << 3) | wire_type
 *
 * Schema (matches the JSON shapes already on /khuloh):
 *
 *   message ZoneMessage {
 *     string id          = 1;
 *     string zoneId      = 2;
 *     string fromId      = 3;
 *     string fromHandle  = 4;
 *     string body        = 5;
 *     string ts          = 6;
 *   }
 *
 *   message Shout {
 *     string zoneId      = 1;
 *     string fromId      = 2;
 *     string fromHandle  = 3;
 *     string body        = 4;
 *     string ts          = 5;
 *   }
 *
 * Empty / null strings are omitted to save bytes. Decoder fills the gaps
 * with empty strings so downstream code never sees `undefined`.
 *
 * Why not protobufjs? Zero dependency, ~80 lines, easy to audit. The
 * messages are tiny and only contain strings — protobufjs is overkill.
 */
const STRING = 2;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

function writeVarint(out, value) {
  let v = value >>> 0;
  while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
  out.push(v & 0x7f);
}

function writeString(out, fieldNum, value) {
  if (value == null) return;
  const s = String(value);
  if (!s) return;
  const bytes = enc.encode(s);
  writeVarint(out, (fieldNum << 3) | STRING);
  writeVarint(out, bytes.length);
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
}

function readVarint(view, state) {
  let result = 0; let shift = 0; let byte;
  do {
    if (state.pos >= view.length) throw new Error('varint_truncated');
    byte = view[state.pos++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return result >>> 0;
}

function readString(view, state) {
  const len = readVarint(view, state);
  if (state.pos + len > view.length) throw new Error('string_truncated');
  const s = dec.decode(view.subarray(state.pos, state.pos + len));
  state.pos += len;
  return s;
}

function decodeFields(buf) {
  const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const state = { pos: 0 };
  const out = {};
  while (state.pos < view.length) {
    const tag = readVarint(view, state);
    const field = tag >>> 3;
    const wire  = tag & 7;
    if (wire !== STRING) throw new Error(`unsupported_wire_type:${wire}`);
    out[field] = readString(view, state);
  }
  return out;
}

// ---------- ZoneMessage ----------

export function encodeZoneMessage(msg) {
  const out = [];
  writeString(out, 1, msg.id);
  writeString(out, 2, msg.zoneId);
  writeString(out, 3, msg.fromId);
  writeString(out, 4, msg.fromHandle);
  writeString(out, 5, msg.body);
  writeString(out, 6, msg.ts);
  return Uint8Array.from(out);
}

export function decodeZoneMessage(buf) {
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

// ---------- Shout ----------

export function encodeShout(s) {
  const out = [];
  writeString(out, 1, s.zoneId);
  writeString(out, 2, s.fromId);
  writeString(out, 3, s.fromHandle);
  writeString(out, 4, s.body);
  writeString(out, 5, s.ts);
  return Uint8Array.from(out);
}

export function decodeShout(buf) {
  const f = decodeFields(buf);
  return {
    zoneId:     f[1] || '',
    fromId:     f[2] || '',
    fromHandle: f[3] || null,
    body:       f[4] || '',
    ts:         f[5] || '',
  };
}

// Estimated savings vs JSON: JSON keys + quoting cost ~70 bytes / msg even
// for short bodies; the binary form drops that to ~8 bytes of overhead.
// On a typical 60-char zone chat message this is ~35-50% smaller, and
// ~3-4x smaller for repeated message batches (no key reduplication).
