import test from 'node:test';
import assert from 'node:assert';
import {
  encodeShout, decodeShout,
  encodeZoneMessage, decodeZoneMessage,
} from '../src/khuloh/wire.js';

test('wire: zone message round-trip', () => {
  const original = {
    id: 'msg-uuid-1234',
    zoneId: 'zone-cpt-1',
    fromId: 'user-abc',
    fromHandle: 'noxolo',
    body: 'Sawubona! Anyone for sundowners at V&A 🌅',
    ts: '2026-05-10T14:30:00.000Z',
  };
  const buf = encodeZoneMessage(original);
  const decoded = decodeZoneMessage(buf);
  assert.deepStrictEqual(decoded, original);
  // Verify it's actually smaller than JSON.
  const jsonLen = Buffer.byteLength(JSON.stringify(original), 'utf8');
  assert.ok(buf.length < jsonLen, `binary ${buf.length} should be < json ${jsonLen}`);
});

test('wire: shout round-trip', () => {
  const original = {
    zoneId: 'zone-jhb-2',
    fromId: 'user-xyz',
    fromHandle: 'thabo',
    body: 'Stokvel meet at the Maboneng food market, 18:00.',
    ts: '2026-05-10T16:00:00.000Z',
  };
  const buf = encodeShout(original);
  const decoded = decodeShout(buf);
  assert.deepStrictEqual(decoded, original);
});

test('wire: null handle decodes as null', () => {
  const buf = encodeZoneMessage({
    id: 'a', zoneId: 'z', fromId: 'u', fromHandle: null, body: 'hi', ts: 't',
  });
  const decoded = decodeZoneMessage(buf);
  assert.strictEqual(decoded.fromHandle, null);
});

test('wire: rejects bogus wire types', () => {
  // 0x08 = field 1 wire type 0 (varint), not supported in our codec.
  assert.throws(() => decodeZoneMessage(new Uint8Array([0x08, 0x01])), /unsupported_wire_type/);
});

test('wire: tolerates unicode and emoji', () => {
  const original = {
    id: '1', zoneId: 'z', fromId: 'u', fromHandle: null,
    body: '🦓🌍 isiZulu: Ngiyaphila wena unjani?',
    ts: '2026-05-10T00:00:00.000Z',
  };
  const decoded = decodeZoneMessage(encodeZoneMessage(original));
  assert.strictEqual(decoded.body, original.body);
});
