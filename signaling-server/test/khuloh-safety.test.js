import test from 'node:test';
import assert from 'node:assert/strict';
import { issueQrToken, verifyQrToken } from '../src/khuloh/partner-qr.js';
import { upsertSafeSpot, _resetSafeSpots } from '../src/khuloh/safe-spots.js';
import { scheduleMeetup, checkIn, _resetMeetups } from '../src/khuloh/meetups.js';

test('partner qr: issued tokens round-trip and reject tampering', () => {
  process.env.KHULOH_QR_SIGNING_KEY = 'test-signing-key-1234';

  const token = issueQrToken({ spotId: 'spot-1', ttlSec: 600 });
  const payload = verifyQrToken(token);
  assert.equal(payload.spot_id, 'spot-1');
  assert.ok(payload.exp > Math.floor(Date.now() / 1000));

  const [payloadSeg, sigSeg] = token.split('.');
  const tampered = `${payloadSeg.startsWith('a') ? 'b' : 'a'}${payloadSeg.slice(1)}.${sigSeg}`;
  assert.throws(() => verifyQrToken(tampered), /bad_signature|bad_token/);

  delete process.env.KHULOH_QR_SIGNING_KEY;
});

test('meetups: check-in enforces GPS radius and moves to in-progress once both users arrive', async () => {
  _resetSafeSpots();
  _resetMeetups();
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

  const spot = await upsertSafeSpot({
    name: 'Rosebank Cafe',
    city: 'Johannesburg',
    lat: -26.145,
    lng: 28.041,
    active: true,
  });
  const meetup = await scheduleMeetup({
    aUid: 'user-a',
    bUid: 'user-b',
    spotId: spot.id,
  });

  await assert.rejects(
    () => checkIn({ meetupId: meetup.id, uid: 'user-a', lat: -26.2, lng: 28.2 }),
    (error) => error?.message === 'too_far_from_spot' && error?.code === 'too_far_from_spot',
  );

  const firstCheckIn = await checkIn({ meetupId: meetup.id, uid: 'user-a', lat: spot.lat, lng: spot.lng });
  assert.equal(firstCheckIn.status, 'scheduled');
  assert.ok(firstCheckIn.a_checked_in_at);
  assert.equal(firstCheckIn.b_checked_in_at, null);

  const secondCheckIn = await checkIn({ meetupId: meetup.id, uid: 'user-b', lat: spot.lat, lng: spot.lng });
  assert.equal(secondCheckIn.status, 'in_progress');
  assert.ok(secondCheckIn.started_at);
  assert.ok(secondCheckIn.b_checked_in_at);
});