/**
 * Sliding-window rate limiter for the endpoints that face guessing or abuse (agent login,
 * admin login, payment initiation, link requests). In-memory: the pilot runs one `web`
 * container (D23); a shared store replaces the map when a second instance exists.
 */
export interface RateLimitVerdict {
  ok: boolean;
  remaining: number;
  /** Seconds until a refused caller may try again (0 when ok). */
  retryAfterSeconds: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(
    readonly max: number,
    readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): RateLimitVerdict {
    this.sweep(now);
    const from = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (recent.length >= this.max) {
      const oldest = recent[0]!;
      return {
        ok: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)),
      };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { ok: true, remaining: this.max - recent.length, retryAfterSeconds: 0 };
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Drops keys with no hit inside the window, at most once a minute. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    const from = now - this.windowMs;
    for (const [key, times] of this.hits) {
      const recent = times.filter((t) => t > from);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }
  }
}

const MINUTE = 60_000;

/** The platform's limits, one limiter per concern (module-level: one process). */
export const limits = {
  /** PIN guessing: per IP, on top of the per-agent lockout after 5 failures. */
  agentLogin: new RateLimiter(20, 15 * MINUTE),
  /** Password guessing on the dashboard: per IP. */
  adminLogin: new RateLimiter(10, 15 * MINUTE),
  /** Payment requests: per agent (a phone cannot spam a household with prompts). */
  agentPayments: new RateLimiter(30, MINUTE),
  /** Self-service payments and link requests: per IP. */
  portalPayments: new RateLimiter(10, MINUTE),
  portalLinks: new RateLimiter(5, 10 * MINUTE),
  /** Position pings: per agent (one batch every 3 minutes in normal use, bursts after offline). */
  agentPositions: new RateLimiter(30, 5 * MINUTE),
};

export function clientKey(ip: string | undefined): string {
  return ip && ip.length > 0 ? ip : "unknown";
}
