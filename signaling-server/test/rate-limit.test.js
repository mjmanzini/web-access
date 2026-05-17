import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryRateLimiter } from '../src/rate-limit.js';

test('rate limiter blocks after max hits within the window', () => {
  let currentTime = 1_000;
  const limiter = createInMemoryRateLimiter({
    windowMs: 5_000,
    max: 2,
    now: () => currentTime,
  });

  assert.equal(limiter.consume('user-1').allowed, true);
  assert.equal(limiter.consume('user-1').allowed, true);

  const blocked = limiter.consume('user-1');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterMs > 0);

  currentTime += 5_001;
  assert.equal(limiter.consume('user-1').allowed, true);
});

test('rate limiter isolates independent keys', () => {
  const limiter = createInMemoryRateLimiter({ windowMs: 10_000, max: 1, now: () => 500 });

  assert.equal(limiter.consume('a').allowed, true);
  assert.equal(limiter.consume('b').allowed, true);
  assert.equal(limiter.consume('a').allowed, false);
});