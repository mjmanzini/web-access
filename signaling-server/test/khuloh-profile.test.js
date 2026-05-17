import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProfile,
  updateOwnProfile,
  _resetKhulohProfiles,
  _seedKhulohProfileUser,
} from '../src/khuloh/profile.js';

test('khuloh profile: returns mobile-facing fields with sane defaults', async () => {
  _resetKhulohProfiles();
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const user = { id: 'user-profile-1', username: 'khuloh.one', displayName: 'Khuloh One', phone: '+27123456789' };
  _seedKhulohProfileUser(user);

  const profile = await getProfile(user.id);
  assert.ok(profile);
  assert.equal(profile.id, user.id);
  assert.equal(profile.username, 'khuloh.one');
  assert.equal(profile.bio, '');
  assert.equal(profile.vibe, 'chat');
  assert.equal(profile.vibe_points, 0);
  assert.equal(profile.trust_score, 0);
  assert.equal(profile.data_light_mode, false);
  assert.equal(profile.phone, '+27123456789');
});

test('khuloh profile: updateOwnProfile persists editable fields', async () => {
  _resetKhulohProfiles();
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const user = { id: 'user-profile-2', username: 'khuloh.two', displayName: 'Khuloh Two', phone: '+27820000000' };
  _seedKhulohProfileUser(user);

  const updated = await updateOwnProfile(user.id, {
    username: 'khuloh.two.next',
    bio: 'Short bio',
    vibe: 'ignite',
    city: 'Johannesburg',
    dataLightMode: true,
  });

  assert.equal(updated.username, 'khuloh.two.next');
  assert.equal(updated.bio, 'Short bio');
  assert.equal(updated.vibe, 'ignite');
  assert.equal(updated.city, 'Johannesburg');
  assert.equal(updated.data_light_mode, true);

  const reread = await getProfile(user.id);
  assert.equal(reread.username, 'khuloh.two.next');
  assert.equal(reread.bio, 'Short bio');
  assert.equal(reread.vibe, 'ignite');
  assert.equal(reread.city, 'Johannesburg');
  assert.equal(reread.data_light_mode, true);
});