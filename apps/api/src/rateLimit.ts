/**
 * Minimal in-memory sliding-window rate limiter, keyed per identity (the
 * authenticated email, or "anonymous"). Intended for a single-instance internal
 * tool; a multi-instance deployment should back this with shared state.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Record a hit; returns false when the caller is over the limit. */
  allow(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff)
    if (recent.length >= this.max) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.set(key, recent)
    return true
  }
}
