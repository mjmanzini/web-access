import test from 'node:test';
import assert from 'node:assert/strict';

const ORIGINAL_ENV = { ...process.env };

function resetIceEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.STUN_URLS;
  delete process.env.TURN_URL;
  delete process.env.TURN_SHARED_SECRET;
  delete process.env.TURN_TTL_SECONDS;
  delete process.env.TURN_USERNAME;
  delete process.env.TURN_PASSWORD;
}

test.afterEach(() => {
  resetIceEnv();
});

test('buildIceServers returns default STUN config', async () => {
  resetIceEnv();
  const { buildIceServers } = await import(`../src/ice.js?case=default-${Date.now()}`);

  assert.deepEqual(buildIceServers(), [
    { urls: ['stun:stun.l.google.com:19302'] },
  ]);
});

test('buildIceServers prefers TURN REST credentials when shared secret is set', async () => {
  resetIceEnv();
  process.env.STUN_URLS = 'stun:stun1.example.com:3478';
  process.env.TURN_URL = 'turn:turn.example.com:3478, turns:turn.example.com:5349';
  process.env.TURN_SHARED_SECRET = 'shared-secret';
  process.env.TURN_TTL_SECONDS = '600';
  const { buildIceServers } = await import(`../src/ice.js?case=rest-${Date.now()}`);

  const servers = buildIceServers();

  assert.equal(servers.length, 2);
  assert.deepEqual(servers[0], { urls: ['stun:stun1.example.com:3478'] });
  assert.deepEqual(servers[1].urls, [
    'turn:turn.example.com:3478',
    'turns:turn.example.com:5349',
  ]);
  assert.match(String(servers[1].username), /^\d+:webaccess$/);
  assert.ok(servers[1].credential);
});

test('buildIceServers omits TURN when credentials are incomplete', async () => {
  resetIceEnv();
  process.env.TURN_URL = 'turn:turn.example.com:3478';
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(message);
  const { buildIceServers } = await import(`../src/ice.js?case=warn-${Date.now()}`);

  try {
    assert.deepEqual(buildIceServers(), [
      { urls: ['stun:stun.l.google.com:19302'] },
    ]);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0]), /TURN_URL set but no credentials/);
});