import { describe, expect, it } from "vitest";

import { lockState } from "@/lib/identity/agent-auth";
import { signAgentToken, verifyAgentToken } from "@/lib/identity/agent-session";

const SECRET = "unit-test-secret-of-at-least-32-characters!";

describe("agent session tokens", () => {
  it("round-trips a signed payload and rejects tampering, bad signatures and expiry", async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = await signAgentToken({ agentId: "a", deviceId: "d", exp }, SECRET);
    expect(await verifyAgentToken(token, SECRET)).toEqual({ agentId: "a", deviceId: "d", exp });
    const [body, sig] = token.split(".") as [string, string];
    expect(await verifyAgentToken(`${body}x.${sig}`, SECRET)).toBeNull();
    expect(await verifyAgentToken(`${body}.${sig.slice(0, -1)}A`, SECRET)).toBeNull();
    expect(await verifyAgentToken(token, "another-secret-of-at-least-32-characters!")).toBeNull();
    expect(await verifyAgentToken(token, SECRET, (exp + 1) * 1000)).toBeNull();
    expect(await verifyAgentToken(undefined, SECRET)).toBeNull();
    expect(await verifyAgentToken("garbage", SECRET)).toBeNull();
  });
});

describe("PIN lockout", () => {
  it("is locked only while locked_until is in the future", () => {
    const now = new Date("2026-09-13T08:00:00Z");
    expect(
      lockState({ failedPinAttempts: 5, lockedUntil: new Date("2026-09-13T08:10:00Z") }, now),
    ).toBe("locked");
    expect(
      lockState({ failedPinAttempts: 5, lockedUntil: new Date("2026-09-13T07:59:00Z") }, now),
    ).toBe("open");
    expect(lockState({ failedPinAttempts: 0, lockedUntil: null }, now)).toBe("open");
  });
});
