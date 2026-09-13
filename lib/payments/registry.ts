import type { PaymentChannel, PaymentProvider } from "./provider";
import { mockProvider } from "./providers/mock";

export class PaymentConfigError extends Error {
  constructor(
    readonly code: "mock_disabled_in_production" | "channel_not_enabled" | "no_provider",
  ) {
    super(code);
    this.name = "PaymentConfigError";
  }
}

/** Providers switched on by PAYMENT_PROVIDERS (comma list). Only `mock` exists today (D11). */
export function enabledProviders(env: NodeJS.ProcessEnv = process.env): PaymentChannel[] {
  return (env.PAYMENT_PROVIDERS ?? "mock")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is PaymentChannel => ["mock", "mpesa", "airtel", "orange", "tpe"].includes(s));
}

/** Channels offered to agents and taxpayers (PAYMENT_CHANNELS); each must resolve to a provider. */
export function availableChannels(
  env: NodeJS.ProcessEnv = process.env,
): Exclude<PaymentChannel, "mock">[] {
  return (env.PAYMENT_CHANNELS ?? "mpesa,airtel,orange")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Exclude<PaymentChannel, "mock"> =>
      ["mpesa", "airtel", "orange", "tpe"].includes(s),
    );
}

/**
 * The provider behind a channel. A real provider wins when enabled; otherwise the mock stands
 * in for every channel, except in production where invariant 1 forbids it.
 */
export function getProvider(
  channel: PaymentChannel,
  env: NodeJS.ProcessEnv = process.env,
): PaymentProvider {
  const enabled = enabledProviders(env);
  if (channel !== "mock" && enabled.includes(channel)) throw new PaymentConfigError("no_provider"); // real providers arrive with D11/D14
  if (!enabled.includes("mock")) throw new PaymentConfigError("channel_not_enabled");
  if (env.APP_ENV === "production") throw new PaymentConfigError("mock_disabled_in_production");
  return mockProvider;
}

export function paymentExpiryHours(env: NodeJS.ProcessEnv = process.env): number {
  // DECISION-PENDING: D28 — 24 hours of re-query before `expired`.
  const n = Number(env.PAYMENT_EXPIRY_HOURS ?? 24);
  return Number.isFinite(n) && n > 0 ? n : 24;
}
