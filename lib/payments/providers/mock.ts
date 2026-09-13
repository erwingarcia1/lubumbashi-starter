import { businessClock } from "@/lib/time";

import type {
  InitiateRequest,
  InitiateResult,
  PaymentChannel,
  PaymentProvider,
  StatementLine,
  StatusContext,
  StatusResult,
} from "../provider";

export const MOCK_CONFIRM_AFTER_MS = 3_000;

/** Amounts ending in 999 fail (docs/MILESTONES.md M5); everything else confirms 3 s later. */
export function mockDecision(
  amountFc: number,
  initiatedAt: Date,
  now: Date,
): "pending" | "confirmed" | "failed" {
  if (amountFc % 1000 === 999) return "failed";
  return now.getTime() - initiatedAt.getTime() >= MOCK_CONFIRM_AFTER_MS ? "confirmed" : "pending";
}

/** Deterministic per platform reference, so a replayed callback carries the same reference. */
export function mockProviderReference(reference: string, at: Date): string {
  const c = businessClock(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `MK${String(c.year).slice(-2)}${pad(c.month)}${pad(c.day)}${reference.slice(-4)}`;
}

/** Where the mock's daily statement comes from (the platform's own ledger, perturbed; M9). */
export type StatementSource = (date: string, channel: PaymentChannel) => Promise<StatementLine[]>;

/**
 * The only provider allowed to confirm without a real operator (invariant 1). Refused in
 * production by the registry. Confirms after 3 s, fails for amounts ending in 999.
 */
export function createMockProvider(statementSource?: StatementSource): PaymentProvider {
  return {
    name: "mock",
    async initiate(request: InitiateRequest): Promise<InitiateResult> {
      return {
        providerRequestId: `MOCK-REQ-${request.reference}`,
        status: "pending",
        raw: { provider: "mock", accepted: true, channel: request.channel },
      };
    },
    async queryStatus(ctx: StatusContext): Promise<StatusResult> {
      const decision = mockDecision(ctx.amountFc, ctx.initiatedAt, ctx.now);
      if (decision === "pending") return { status: "pending" };
      if (decision === "failed") {
        return {
          status: "failed",
          failureCode: "INSUFFICIENT_FUNDS",
          failureReason: "Solde insuffisant",
          raw: { provider: "mock", reference: ctx.reference, result: "failed" },
        };
      }
      const providerReference = mockProviderReference(ctx.reference, ctx.initiatedAt);
      return {
        status: "confirmed",
        providerReference,
        amountFc: ctx.amountFc,
        payerPhone: ctx.payerPhone,
        providerTime: new Date(ctx.initiatedAt.getTime() + MOCK_CONFIRM_AFTER_MS),
        raw: {
          provider: "mock",
          reference: ctx.reference,
          providerReference,
          amountFc: ctx.amountFc,
          result: "confirmed",
        },
      };
    },
    async reverse(ctx) {
      return {
        ok: true,
        providerReference: `${ctx.providerReference}-REV`,
        raw: { provider: "mock", reversed: ctx.reference },
      };
    },
    async fetchStatement(date: string, channel: PaymentChannel = "mock"): Promise<StatementLine[]> {
      // The statement is the platform's own ledger with one missing, one duplicate and one unknown
      // line (docs/MILESTONES.md M9); without a source there is nothing to report.
      return statementSource ? statementSource(date, channel) : [];
    },
  };
}

export const mockProvider: PaymentProvider = createMockProvider();
