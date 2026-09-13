import { describe, expect, it } from "vitest";

import { RateLimiter, clientKey, limits } from "@/lib/security/rate-limit";

describe("rate limiter (M10 hardening)", () => {
  it("allows up to max hits in the window, then refuses with a retry delay", () => {
    const rl = new RateLimiter(3, 10_000);
    const t0 = 1_000_000;
    expect(rl.check("a", t0)).toMatchObject({ ok: true, remaining: 2 });
    expect(rl.check("a", t0 + 100)).toMatchObject({ ok: true, remaining: 1 });
    expect(rl.check("a", t0 + 200)).toMatchObject({ ok: true, remaining: 0 });
    const refused = rl.check("a", t0 + 300);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterSeconds).toBe(10);
    // Another key is independent; the window slides.
    expect(rl.check("b", t0 + 300).ok).toBe(true);
    expect(rl.check("a", t0 + 10_001).ok).toBe(true);
  });

  it("reset clears a key and sweeping forgets idle keys", () => {
    const rl = new RateLimiter(1, 1_000);
    expect(rl.check("x", 0).ok).toBe(true);
    expect(rl.check("x", 10).ok).toBe(false);
    rl.reset("x");
    expect(rl.check("x", 20).ok).toBe(true);
    expect(rl.check("y", 20).ok).toBe(true);
    // 61 s later the sweep runs: both keys are idle and dropped, then usable again.
    expect(rl.check("x", 61_100).ok).toBe(true);
    expect(rl.check("y", 61_200).ok).toBe(true);
  });

  it("platform limits exist for logins, payments and links; unknown IPs share one bucket", () => {
    expect(limits.agentLogin.max).toBe(20);
    expect(limits.adminLogin.max).toBe(10);
    expect(limits.agentPayments.max).toBe(30);
    expect(limits.portalPayments.max).toBe(10);
    expect(limits.portalLinks.max).toBe(5);
    expect(clientKey(undefined)).toBe("unknown");
    expect(clientKey("10.0.0.1")).toBe("10.0.0.1");
  });
});
