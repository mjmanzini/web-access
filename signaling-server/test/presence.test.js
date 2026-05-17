import test from 'node:test';
import assert from 'node:assert';
import {
  addPresence, removePresence, removeSocket, listPresence, _resetPresence,
} from '../src/khuloh/presence.js';

test('presence: single user shows up once', () => {
  _resetPresence();
  const r = addPresence({ zoneId: 'z1', socketId: 's1', uid: 'u1', handle: 'noxolo' });
  assert.strictEqual(r.changed, true);
  const snap = listPresence('z1');
  assert.strictEqual(snap.count, 1);
  assert.deepStrictEqual(snap.members, [{ uid: 'u1', handle: 'noxolo' }]);
});

test('presence: two tabs from same user counted once', () => {
  _resetPresence();
  const r1 = addPresence({ zoneId: 'z1', socketId: 's1', uid: 'u1', handle: 'thabo' });
  const r2 = addPresence({ zoneId: 'z1', socketId: 's2', uid: 'u1', handle: 'thabo' });
  assert.strictEqual(r1.changed, true);
  assert.strictEqual(r2.changed, false);
  assert.strictEqual(listPresence('z1').count, 1);

  // Closing first tab keeps user online.
  const r3 = removePresence({ zoneId: 'z1', socketId: 's1', uid: 'u1' });
  assert.strictEqual(r3.changed, false);
  assert.strictEqual(listPresence('z1').count, 1);

  // Closing last tab removes.
  const r4 = removePresence({ zoneId: 'z1', socketId: 's2', uid: 'u1' });
  assert.strictEqual(r4.changed, true);
  assert.strictEqual(listPresence('z1').count, 0);
});

test('presence: removeSocket sweeps every zone the socket was in', () => {
  _resetPresence();
  addPresence({ zoneId: 'z1', socketId: 's1', uid: 'u1', handle: 'a' });
  addPresence({ zoneId: 'z2', socketId: 's1', uid: 'u1', handle: 'a' });
  const dropped = removeSocket('s1');
  assert.deepStrictEqual(dropped.sort(), ['z1', 'z2']);
  assert.strictEqual(listPresence('z1').count, 0);
  assert.strictEqual(listPresence('z2').count, 0);
});
