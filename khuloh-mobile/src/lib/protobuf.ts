// ── Lightweight Protobuf-style binary codec for Khuloh ──
// Zero-dependency varint + length-delimited encoding
// Matches proto/khuloh.proto schema — ~70% smaller than JSON

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ── Varint encoding ──
function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let v = value >>> 0;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0x7f);
  return bytes;
}

function decodeVarint(buf: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length) {
    const b = buf[pos];
    result |= (b & 0x7f) << shift;
    pos++;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return [result >>> 0, pos];
}

// ── Field writers ──
function writeString(fieldNum: number, value: string): number[] {
  if (!value) return [];
  const encoded = encoder.encode(value);
  return [
    ...encodeVarint((fieldNum << 3) | 2), // wire type 2 = length-delimited
    ...encodeVarint(encoded.length),
    ...Array.from(encoded),
  ];
}

function writeInt32(fieldNum: number, value: number): number[] {
  if (value === 0) return [];
  return [...encodeVarint((fieldNum << 3) | 0), ...encodeVarint(value)];
}

function writeInt64(fieldNum: number, value: number): number[] {
  if (value === 0) return [];
  // Encode as two 32-bit varints for JS safety
  const lo = value >>> 0;
  const hi = Math.floor(value / 0x100000000) >>> 0;
  const tag = encodeVarint((fieldNum << 3) | 0);
  if (hi === 0) return [...tag, ...encodeVarint(lo)];
  // Full 64-bit encoding
  const bytes: number[] = [...tag];
  let combined = value;
  while (combined > 0x7f) {
    bytes.push((combined & 0x7f) | 0x80);
    combined = Math.floor(combined / 128);
  }
  bytes.push(combined & 0x7f);
  return bytes;
}

function writeBool(fieldNum: number, value: boolean): number[] {
  if (!value) return [];
  return [...encodeVarint((fieldNum << 3) | 0), 1];
}

function writeDouble(fieldNum: number, value: number): number[] {
  if (value === 0) return [];
  const buf = new ArrayBuffer(8);
  new Float64Array(buf)[0] = value;
  const bytes = Array.from(new Uint8Array(buf));
  return [...encodeVarint((fieldNum << 3) | 1), ...bytes];
}

// ── Field readers ──
function readFields(buf: Uint8Array): Map<number, { wireType: number; data: Uint8Array | number }[]> {
  const fields = new Map<number, { wireType: number; data: Uint8Array | number }[]>();
  let pos = 0;

  while (pos < buf.length) {
    const [tag, newPos] = decodeVarint(buf, pos);
    pos = newPos;
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x7;

    let data: Uint8Array | number;

    if (wireType === 0) {
      // varint
      const [val, np] = decodeVarint(buf, pos);
      pos = np;
      data = val;
    } else if (wireType === 1) {
      // 64-bit fixed
      data = buf.slice(pos, pos + 8);
      pos += 8;
    } else if (wireType === 2) {
      // length-delimited
      const [len, np] = decodeVarint(buf, pos);
      pos = np;
      data = buf.slice(pos, pos + len);
      pos += len;
    } else {
      break; // unknown wire type
    }

    if (!fields.has(fieldNum)) fields.set(fieldNum, []);
    fields.get(fieldNum)!.push({ wireType, data });
  }

  return fields;
}

function getString(fields: ReturnType<typeof readFields>, fieldNum: number): string {
  const entries = fields.get(fieldNum);
  if (!entries?.length) return '';
  const d = entries[0].data;
  return d instanceof Uint8Array ? decoder.decode(d) : '';
}

function getInt32(fields: ReturnType<typeof readFields>, fieldNum: number): number {
  const entries = fields.get(fieldNum);
  if (!entries?.length) return 0;
  return typeof entries[0].data === 'number' ? entries[0].data : 0;
}

function getBool(fields: ReturnType<typeof readFields>, fieldNum: number): boolean {
  return getInt32(fields, fieldNum) !== 0;
}

function getDouble(fields: ReturnType<typeof readFields>, fieldNum: number): number {
  const entries = fields.get(fieldNum);
  if (!entries?.length) return 0;
  const d = entries[0].data;
  if (d instanceof Uint8Array && d.length === 8) {
    return new Float64Array(d.buffer, d.byteOffset, 1)[0];
  }
  return 0;
}

// ── ChatMessage codec ─────────────────────────────────────

export type PbChatMessage = {
  id: string;
  sender_id: string;
  room_id: string;
  body: string;
  timestamp_ms: number;
  sender_vibe: number; // 0=chat, 1=connect, 2=ignite
  sender_username: string;
  is_whisper: boolean;
  is_flagged: boolean;
};

export function encodeChatMessage(msg: PbChatMessage): Uint8Array {
  const bytes = [
    ...writeString(1, msg.id),
    ...writeString(2, msg.sender_id),
    ...writeString(3, msg.room_id),
    ...writeString(4, msg.body),
    ...writeInt64(5, msg.timestamp_ms),
    ...writeInt32(6, msg.sender_vibe),
    ...writeString(7, msg.sender_username),
    ...writeBool(8, msg.is_whisper),
    ...writeBool(9, msg.is_flagged),
  ];
  return new Uint8Array(bytes);
}

export function decodeChatMessage(buf: Uint8Array): PbChatMessage {
  const f = readFields(buf);
  return {
    id: getString(f, 1),
    sender_id: getString(f, 2),
    room_id: getString(f, 3),
    body: getString(f, 4),
    timestamp_ms: getInt32(f, 5),
    sender_vibe: getInt32(f, 6),
    sender_username: getString(f, 7),
    is_whisper: getBool(f, 8),
    is_flagged: getBool(f, 9),
  };
}

// ── PointTransaction codec ────────────────────────────────

export type PbPointTransaction = {
  id: string;
  user_id: string;
  amount: number;
  reason: number; // enum index from proto
  timestamp_ms: number;
};

export function encodePointTransaction(tx: PbPointTransaction): Uint8Array {
  const bytes = [
    ...writeString(1, tx.id),
    ...writeString(2, tx.user_id),
    ...writeInt32(3, tx.amount),
    ...writeInt32(4, tx.reason),
    ...writeInt64(5, tx.timestamp_ms),
  ];
  return new Uint8Array(bytes);
}

export function decodePointTransaction(buf: Uint8Array): PbPointTransaction {
  const f = readFields(buf);
  return {
    id: getString(f, 1),
    user_id: getString(f, 2),
    amount: getInt32(f, 3),
    reason: getInt32(f, 4),
    timestamp_ms: getInt32(f, 5),
  };
}

// ── SafeCheckinRequest/Response codec ─────────────────────

export type PbSafeCheckinRequest = {
  safe_spot_id: string;
  partner_id: string;
  latitude: number;
  longitude: number;
  timestamp_ms: number;
};

export function encodeSafeCheckinRequest(req: PbSafeCheckinRequest): Uint8Array {
  const bytes = [
    ...writeString(1, req.safe_spot_id),
    ...writeString(2, req.partner_id),
    ...writeDouble(3, req.latitude),
    ...writeDouble(4, req.longitude),
    ...writeInt64(5, req.timestamp_ms),
  ];
  return new Uint8Array(bytes);
}

export function decodeSafeCheckinResponse(buf: Uint8Array): {
  success: boolean;
  checkin_id: string;
  checkin_code: string;
  points_awarded: number;
  error: string;
} {
  const f = readFields(buf);
  return {
    success: getBool(f, 1),
    checkin_id: getString(f, 2),
    checkin_code: getString(f, 3),
    points_awarded: getInt32(f, 4),
    error: getString(f, 5),
  };
}

// ── Batch helpers ─────────────────────────────────────────

export function encodeChatBatch(messages: PbChatMessage[], serverTs: number): Uint8Array {
  const parts: number[] = [];
  for (const msg of messages) {
    const encoded = encodeChatMessage(msg);
    parts.push(...encodeVarint((1 << 3) | 2));
    parts.push(...encodeVarint(encoded.length));
    parts.push(...Array.from(encoded));
  }
  parts.push(...writeInt64(2, serverTs));
  return new Uint8Array(parts);
}

export function encodePointsBatch(
  txns: PbPointTransaction[],
  balance: number,
  lastSyncedMs: number,
): Uint8Array {
  const parts: number[] = [];
  for (const tx of txns) {
    const encoded = encodePointTransaction(tx);
    parts.push(...encodeVarint((1 << 3) | 2));
    parts.push(...encodeVarint(encoded.length));
    parts.push(...Array.from(encoded));
  }
  parts.push(...writeInt32(2, balance));
  parts.push(...writeInt64(3, lastSyncedMs));
  return new Uint8Array(parts);
}

// ── Size comparison helper ──
export function measureSavings(jsonStr: string, protoBuf: Uint8Array): {
  jsonBytes: number;
  protoBytes: number;
  savingPct: number;
} {
  const jsonBytes = new TextEncoder().encode(jsonStr).length;
  const protoBytes = protoBuf.length;
  const savingPct = Math.round((1 - protoBytes / jsonBytes) * 100);
  return { jsonBytes, protoBytes, savingPct };
}
