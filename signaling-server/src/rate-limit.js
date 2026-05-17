function clientKeyFromReq(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0]?.trim();
  return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

export function createInMemoryRateLimiter({ windowMs, max, now = () => Date.now() }) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error('invalid_window_ms');
  if (!Number.isFinite(max) || max <= 0) throw new Error('invalid_max');

  const buckets = new Map();

  function consume(key) {
    const bucketKey = String(key || 'anonymous');
    const currentTime = now();
    const existing = buckets.get(bucketKey);

    if (!existing || existing.resetAt <= currentTime) {
      const next = { count: 1, resetAt: currentTime + windowMs };
      buckets.set(bucketKey, next);
      return {
        allowed: true,
        limit: max,
        remaining: Math.max(0, max - next.count),
        retryAfterMs: 0,
        resetAt: next.resetAt,
      };
    }

    if (existing.count >= max) {
      return {
        allowed: false,
        limit: max,
        remaining: 0,
        retryAfterMs: Math.max(0, existing.resetAt - currentTime),
        resetAt: existing.resetAt,
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      limit: max,
      remaining: Math.max(0, max - existing.count),
      retryAfterMs: 0,
      resetAt: existing.resetAt,
    };
  }

  function reset(key) {
    buckets.delete(String(key || 'anonymous'));
  }

  return { consume, reset };
}

export function createRateLimitMiddleware({
  windowMs,
  max,
  keyFn = (req) => req.user?.id || clientKeyFromReq(req),
  error = 'rate_limited',
}) {
  const limiter = createInMemoryRateLimiter({ windowMs, max });

  return function rateLimitMiddleware(req, res, next) {
    const result = limiter.consume(keyFn(req));
    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error, retryAfterSeconds });
    }
    next();
  };
}