/**
 * THE DIALOGUE (D1c) — sliding-window rate limiter for dialog_event.
 *
 * Client-side debounce is UX, not a control (R2#3): the BROKER caps how many
 * live-dialog interactions a single principal can drive per minute so a buggy
 * or hostile panel can't storm the agent with turns. Pure + injectable clock
 * so tests are deterministic.
 */

export interface RateLimitConfig {
  windowMs: number
  max: number
}

/** Per-principal cap on dialog_event submissions (R2#3). */
export const DIALOG_EVENT_RATE: RateLimitConfig = { windowMs: 60_000, max: 30 }

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(private readonly cfg: RateLimitConfig) {}

  /**
   * Record a hit for `key` and return whether it is allowed. When the key is
   * already at the limit within the window, the hit is NOT recorded and `false`
   * is returned (caller rejects).
   */
  check(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.cfg.windowMs
    const recent = (this.hits.get(key) ?? []).filter(t => t > cutoff)
    if (recent.length >= this.cfg.max) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.set(key, recent)
    return true
  }

  /** Drop all recorded hits for a key (or everything when omitted). */
  reset(key?: string): void {
    if (key === undefined) this.hits.clear()
    else this.hits.delete(key)
  }
}
