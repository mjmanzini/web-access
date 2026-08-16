import { RateLimiter } from '../common/rate-limit.util';

/**
 * The login throttle, as behaviour rather than as an implementation.
 *
 * Cloudflare Access has been absorbing password guessing until now. Once the
 * app is its own front door, these are the properties that have to hold —
 * expressed against the limiter the login path uses, so a change to its
 * semantics (an accidental "reset on failure", a window that never expires) is
 * caught here rather than in production.
 */
describe('login throttling', () => {
  const MAX = 5;
  const WINDOW = 15 * 60_000;

  it('allows a handful of failures, then stops', () => {
    const limiter = new RateLimiter(MAX, WINDOW);
    for (let i = 0; i < MAX; i++) expect(limiter.allow('maria')).toBe(true);
    expect(limiter.allow('maria')).toBe(false);
    expect(limiter.count('maria')).toBe(MAX);
  });

  it('a correct password clears the count, so fumbling never accumulates', () => {
    const limiter = new RateLimiter(MAX, WINDOW);
    limiter.allow('maria');
    limiter.allow('maria');
    expect(limiter.count('maria')).toBe(2);

    limiter.reset('maria'); // what a successful login does
    expect(limiter.count('maria')).toBe(0);
    for (let i = 0; i < MAX; i++) expect(limiter.allow('maria')).toBe(true);
  });

  it('keeps accounts independent — one lockout does not lock the household out', () => {
    const limiter = new RateLimiter(MAX, WINDOW);
    for (let i = 0; i < MAX + 2; i++) limiter.allow('maria');

    expect(limiter.allow('maria')).toBe(false);
    expect(limiter.allow('jastice')).toBe(true);
  });

  it('reports a wait the client can act on', () => {
    const limiter = new RateLimiter(MAX, WINDOW);
    for (let i = 0; i < MAX; i++) limiter.allow('maria');

    const wait = limiter.retryAfterSeconds('maria');
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(WINDOW / 1000);
  });

  it('forgives once the window passes', () => {
    jest.useFakeTimers();
    try {
      const limiter = new RateLimiter(MAX, WINDOW);
      for (let i = 0; i < MAX; i++) limiter.allow('maria');
      expect(limiter.allow('maria')).toBe(false);

      jest.setSystemTime(Date.now() + WINDOW + 1000);
      expect(limiter.allow('maria')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('the per-IP ceiling is looser than the per-account one', () => {
    // A household behind one address must not lock itself out by having several
    // people sign in; a single host grinding many usernames still hits a wall.
    const perAccount = new RateLimiter(5, WINDOW);
    const perIp = new RateLimiter(30, WINDOW);

    for (let i = 0; i < 20; i++) perIp.allow('41.13.1.1');
    expect(perIp.allow('41.13.1.1')).toBe(true);

    for (let i = 0; i < 5; i++) perAccount.allow('maria');
    expect(perAccount.allow('maria')).toBe(false);
  });
});
