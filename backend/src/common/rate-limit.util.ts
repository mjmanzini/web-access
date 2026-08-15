/**
 * Minimal in-memory, per-key rate limiter.
 *
 * Used to protect the one unauthenticated write in the app (a child submitting
 * an unblock request). Deliberately dependency-free and process-local: this is
 * abuse damping for a single-household deployment, not a distributed quota.
 * A restart forgives everyone, which is fine for the threat model.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Records an attempt. Returns false when the key is over its allowance. */
  allow(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);

    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }

    recent.push(now);
    this.hits.set(key, recent);

    // Opportunistic sweep so a long-running process doesn't accumulate keys.
    if (this.hits.size > 500) {
      for (const [k, times] of this.hits) {
        if (!times.some((t) => now - t < this.windowMs)) this.hits.delete(k);
      }
    }
    return true;
  }

  /** Seconds until the key's oldest recorded hit falls out of the window. */
  retryAfterSeconds(key: string): number {
    const times = this.hits.get(key) ?? [];
    if (!times.length) return 0;
    const oldest = Math.min(...times);
    return Math.max(1, Math.ceil((this.windowMs - (Date.now() - oldest)) / 1000));
  }
}
