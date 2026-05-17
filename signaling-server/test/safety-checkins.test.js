import test from 'node:test';
import assert from 'node:assert/strict';
import { setContacts, _resetPanicState } from '../src/khuloh/panic.js';
import {
  createSafetyCheckin,
  listMySafetyCheckins,
  markSafetyCheckinSafe,
  processDueSafetyCheckins,
  _resetSafetyCheckins,
} from '../src/khuloh/safety-checkins.js';

test('safety check-ins: create, list, and mark safe for the owner', async () => {
  _resetSafetyCheckins();
  _resetPanicState();
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

  const created = await createSafetyCheckin({
    uid: 'user-safe',
    metUserId: 'user-met',
    checkAt: new Date(Date.now() + 60_000).toISOString(),
  });

  const listed = await listMySafetyCheckins('user-safe');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, created.id);
  assert.equal(listed[0].status, 'pending');

  const safe = await markSafetyCheckinSafe({ checkinId: created.id, uid: 'user-safe' });
  assert.equal(safe.status, 'safe');
  assert.ok(safe.responded_at);
});

test('safety check-ins: overdue pending check-ins escalate to alerted', async () => {
  _resetSafetyCheckins();
  _resetPanicState();
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.KHULOH_KMS_KEY;

  await setContacts('user-overdue', [{ name: 'Alice', email: 'alice@example.com', phone: null }]);
  const overdue = await createSafetyCheckin({
    uid: 'user-overdue',
    metUserId: 'user-met',
    checkAt: new Date(Date.now() - 60_000).toISOString(),
  });

  const result = await processDueSafetyCheckins();
  assert.equal(result.processed, 1);

  const listed = await listMySafetyCheckins('user-overdue');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, overdue.id);
  assert.equal(listed[0].status, 'alerted');
  assert.ok(listed[0].alerted_at);
});