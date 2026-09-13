import type { Allocation, ObligationBalance } from "./types";

export type ObligationStatus = "due" | "partially_paid" | "paid";

export function obligationStatus(
  o: Pick<ObligationBalance, "amountFc" | "penaltyFc" | "paidFc">,
): ObligationStatus {
  if (o.paidFc >= o.amountFc + o.penaltyFc) return "paid";
  if (o.paidFc > 0) return "partially_paid";
  return "due";
}

export interface AllocationResult {
  allocations: Allocation[];
  /** Amount left after every obligation is settled (overpayment; the caller decides). */
  remainderFc: number;
}

/**
 * Splits a payment over obligations, oldest due date first, principal before penalty within an
 * obligation. Pure: does not mutate its inputs.
 */
// DECISION-PENDING: D5 — partial payments allowed, oldest obligation first.
export function allocatePayment(
  amountFc: number,
  obligations: ObligationBalance[],
): AllocationResult {
  if (!Number.isInteger(amountFc) || amountFc <= 0) {
    throw new RangeError(`allocatePayment: amount must be a positive integer, got ${amountFc}`);
  }
  const ordered = [...obligations].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const allocations: Allocation[] = [];
  let remaining = amountFc;
  for (const o of ordered) {
    if (remaining === 0) break;
    const paidPrincipal = Math.min(o.paidFc, o.amountFc);
    const paidPenalty = o.paidFc - paidPrincipal;
    const principalDue = o.amountFc - paidPrincipal;
    const penaltyDue = o.penaltyFc - paidPenalty;
    if (principalDue > 0) {
      const take = Math.min(remaining, principalDue);
      allocations.push({ obligationId: o.id, kind: "principal", amountFc: take });
      remaining -= take;
    }
    if (remaining > 0 && penaltyDue > 0) {
      const take = Math.min(remaining, penaltyDue);
      allocations.push({ obligationId: o.id, kind: "penalty", amountFc: take });
      remaining -= take;
    }
  }
  return { allocations, remainderFc: remaining };
}
