import test from 'node:test';
import assert from 'node:assert/strict';
import { getContacts, setContacts, triggerPanic, _resetPanicState } from '../src/khuloh/panic.js';

test('panic: contacts are sanitized and capped at three entries', async () => {
  _resetPanicState();
  delete process.env.KHULOH_KMS_KEY;

  const contacts = await setContacts('user-1', [
    { name: '  Alice  ', phone: ' +27123456789 ', email: ' alice@example.com ' },
    { name: 'Bob', phone: '', email: 'bob@example.com' },
    { name: 'Carol', phone: '0820000000', email: '' },
    { name: 'Dave', phone: '0830000000', email: 'dave@example.com' },
    { name: '   ', phone: '0840000000', email: null },
  ]);

  assert.deepEqual(contacts, [
    { name: 'Alice', phone: '+27123456789', email: 'alice@example.com' },
    { name: 'Bob', phone: null, email: 'bob@example.com' },
    { name: 'Carol', phone: '0820000000', email: null },
  ]);

  const stored = await getContacts('user-1');
  assert.deepEqual(stored, contacts);
});

test('panic: trigger is rate limited on the fourth attempt within an hour', async () => {
  _resetPanicState();
  delete process.env.KHULOH_KMS_KEY;

  await setContacts('user-2', [{ name: 'Alice', phone: null, email: 'alice@example.com' }]);

  await triggerPanic({ uid: 'user-2', userLabel: 'User Two' });
  await triggerPanic({ uid: 'user-2', userLabel: 'User Two' });
  await triggerPanic({ uid: 'user-2', userLabel: 'User Two' });

  await assert.rejects(
    () => triggerPanic({ uid: 'user-2', userLabel: 'User Two' }),
    (error) => error?.message === 'rate_limited' && error?.code === 'rate_limited',
  );
});