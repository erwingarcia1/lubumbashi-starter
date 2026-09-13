import { describe, expect, it } from "vitest";

import { mockDecision, mockProvider, mockProviderReference } from "./providers/mock";
import { REFERENCE_RE, generateReference, isReference } from "./reference";
import {
  PaymentConfigError,
  availableChannels,
  enabledProviders,
  getProvider,
  paymentExpiryHours,
} from "./registry";
import { FINAL_STATUSES, transition, type PaymentEvent, type PaymentStatus } from "./state-machine";

const STATUSES: PaymentStatus[] = [
  "initiated",
  "pending",
  "confirmed",
  "failed",
  "reversed",
  "expired",
];
const EVENTS: PaymentEvent[] = [
  "provider_accepted",
  "provider_rejected",
  "provider_confirmed",
  "provider_failed",
  "expired",
  "reversed",
];

describe("payment state machine", () => {
  it("allows exactly the documented transitions", () => {
    const allowed: Array<[PaymentStatus, PaymentEvent, PaymentStatus, boolean]> = [
      ["initiated", "provider_accepted", "pending", false],
      ["initiated", "provider_rejected", "failed", false],
      ["initiated", "provider_confirmed", "confirmed", false],
      ["initiated", "provider_failed", "failed", false],
      ["pending", "provider_confirmed", "confirmed", false],
      ["pending", "provider_failed", "failed", false],
      ["pending", "expired", "expired", false],
      ["expired", "provider_confirmed", "confirmed", true],
      ["expired", "provider_failed", "failed", false],
      ["confirmed", "reversed", "reversed", false],
    ];
    for (const [from, event, to, late] of allowed)
      expect(transition(from, event), `${from}+${event}`).toEqual({ ok: true, to, late });
    const allowedKeys = new Set(allowed.map(([f, e]) => `${f}+${e}`));
    for (const from of STATUSES) {
      for (const event of EVENTS) {
        if (allowedKeys.has(`${from}+${event}`)) continue;
        const t = transition(from, event);
        expect(t.ok, `${from}+${event}`).toBe(false);
      }
    }
  });
  it("treats a replayed final result as already_final, never as an error", () => {
    expect(transition("confirmed", "provider_confirmed")).toEqual({
      ok: false,
      reason: "already_final",
    });
    expect(transition("failed", "provider_failed")).toEqual({ ok: false, reason: "already_final" });
    expect(transition("failed", "provider_confirmed")).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
    expect(transition("reversed", "provider_confirmed")).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
    expect(FINAL_STATUSES).toEqual(["confirmed", "failed", "reversed"]);
  });
});

describe("platform references (invariant 5)", () => {
  it("formats TX-YYMM-DD-HHMM-XXXX in business time with an unambiguous alphabet", () => {
    const ref = generateReference(new Date("2026-09-13T06:42:00Z"), () => 0); // 08:42 in Lubumbashi
    expect(ref).toBe("TX-2609-13-0842-AAAA");
    expect(isReference(ref)).toBe(true);
    expect(generateReference(new Date("2026-09-30T22:30:00Z"), (n) => n - 1)).toBe(
      "TX-2610-01-0030-9999",
    );
    expect(isReference("TX-2609-13-0842-7K")).toBe(false);
    expect(isReference("TX-2609-13-0842-0O1I")).toBe(false);
    expect(REFERENCE_RE.test(generateReference(new Date()))).toBe(true);
  });
});

describe("mock provider", () => {
  it("confirms after 3 s and fails amounts ending in 999", async () => {
    const t0 = new Date("2026-09-13T06:42:00Z");
    expect(mockDecision(10000, t0, new Date(t0.getTime() + 2999))).toBe("pending");
    expect(mockDecision(10000, t0, new Date(t0.getTime() + 3000))).toBe("confirmed");
    expect(mockDecision(4999, t0, t0)).toBe("failed");
    const init = await mockProvider.initiate({
      reference: "TX-2609-13-0842-AAAA",
      amountFc: 10000,
      payerPhone: "+243990000000",
      channel: "mpesa",
      description: "x",
    });
    expect(init).toMatchObject({
      status: "pending",
      providerRequestId: "MOCK-REQ-TX-2609-13-0842-AAAA",
    });
    const ctx = {
      reference: "TX-2609-13-0842-AAAA",
      providerRequestId: init.providerRequestId,
      amountFc: 10000,
      payerPhone: "+243990000000",
      initiatedAt: t0,
      now: new Date(t0.getTime() + 5000),
    };
    const confirmed = await mockProvider.queryStatus(ctx);
    expect(confirmed).toMatchObject({
      status: "confirmed",
      providerReference: "MK260913AAAA",
      amountFc: 10000,
    });
    expect(await mockProvider.queryStatus({ ...ctx, now: t0 })).toEqual({ status: "pending" });
    expect(await mockProvider.queryStatus({ ...ctx, amountFc: 4999 })).toMatchObject({
      status: "failed",
      failureReason: "Solde insuffisant",
    });
    expect(mockProviderReference("TX-2609-13-0842-AAAA", t0)).toBe("MK260913AAAA");
    expect(
      (
        await mockProvider.reverse({
          reference: "x",
          providerReference: "MK1",
          amountFc: 1,
          reason: "test",
        })
      ).ok,
    ).toBe(true);
    expect(await mockProvider.fetchStatement("2026-09-13")).toEqual([]);
  });
});

const envOf = (o: Record<string, string>): NodeJS.ProcessEnv => o as unknown as NodeJS.ProcessEnv;

describe("provider registry (invariant 1 guard)", () => {
  it("routes every channel to the mock outside production and refuses it in production", () => {
    const env = envOf({
      PAYMENT_PROVIDERS: "mock",
      PAYMENT_CHANNELS: "mpesa,airtel",
      APP_ENV: "demo",
    });
    expect(enabledProviders(env)).toEqual(["mock"]);
    expect(availableChannels(env)).toEqual(["mpesa", "airtel"]);
    expect(getProvider("mpesa", env).name).toBe("mock");
    expect(getProvider("mock", env).name).toBe("mock");
    expect(() =>
      getProvider("mpesa", envOf({ PAYMENT_PROVIDERS: "mock", APP_ENV: "production" })),
    ).toThrow(PaymentConfigError);
    try {
      getProvider("mpesa", envOf({ PAYMENT_PROVIDERS: "mock", APP_ENV: "production" }));
    } catch (e) {
      expect((e as PaymentConfigError).code).toBe("mock_disabled_in_production");
    }
    expect(() => getProvider("mpesa", envOf({ PAYMENT_PROVIDERS: "" }))).toThrow(
      /channel_not_enabled/,
    );
    expect(() => getProvider("mpesa", envOf({ PAYMENT_PROVIDERS: "mpesa" }))).toThrow(
      /no_provider/,
    );
    expect(enabledProviders(envOf({}))).toEqual(["mock"]);
    expect(availableChannels(envOf({}))).toEqual(["mpesa", "airtel", "orange"]);
    expect(paymentExpiryHours(envOf({}))).toBe(24);
    expect(paymentExpiryHours(envOf({ PAYMENT_EXPIRY_HOURS: "6" }))).toBe(6);
    expect(paymentExpiryHours(envOf({ PAYMENT_EXPIRY_HOURS: "nope" }))).toBe(24);
  });
});
