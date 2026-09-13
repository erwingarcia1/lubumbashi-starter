/**
 * Payment status transitions (docs/MILESTONES.md M5 notes, D28). Pure and exhaustively tested:
 * `confirmed` is reachable only through a provider result, `expired → confirmed` is a late
 * confirmation that is flagged, `failed → confirmed` is refused (reconciliation exception).
 */
export type PaymentStatus =
  "initiated" | "pending" | "confirmed" | "failed" | "reversed" | "expired";

export type PaymentEvent =
  | "provider_accepted"
  | "provider_rejected"
  | "provider_confirmed"
  | "provider_failed"
  | "expired"
  | "reversed";

export type Transition =
  | { ok: true; to: PaymentStatus; late: boolean }
  | { ok: false; reason: "already_final" | "invalid_transition" };

const TABLE: Record<PaymentStatus, Partial<Record<PaymentEvent, PaymentStatus>>> = {
  initiated: {
    provider_accepted: "pending",
    provider_rejected: "failed",
    provider_confirmed: "confirmed",
    provider_failed: "failed",
  },
  pending: { provider_confirmed: "confirmed", provider_failed: "failed", expired: "expired" },
  expired: { provider_confirmed: "confirmed", provider_failed: "failed" },
  confirmed: { reversed: "reversed" },
  failed: {},
  reversed: {},
};

export const FINAL_STATUSES: readonly PaymentStatus[] = ["confirmed", "failed", "reversed"];

export function transition(from: PaymentStatus, event: PaymentEvent): Transition {
  const to = TABLE[from][event];
  if (to) return { ok: true, to, late: from === "expired" && event === "provider_confirmed" };
  // A confirmed payment receiving the same confirmation again is a replay, not an error.
  if (from === "confirmed" && event === "provider_confirmed")
    return { ok: false, reason: "already_final" };
  if (from === "failed" && event === "provider_failed")
    return { ok: false, reason: "already_final" };
  return { ok: false, reason: "invalid_transition" };
}
