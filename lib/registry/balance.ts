/** What a taxpayer owes, from its obligations (status pills of the prototype). */
export interface ObligationLike {
  status: "due" | "partially_paid" | "paid" | "waived" | "cancelled";
  amountFc: number;
  penaltyFc: number;
  paidFc: number;
  dueDate: string;
}

export type BalancePill = "paid" | "due" | "late";

export interface Balance {
  /** Principal + penalties of every obligation that counts (waived and cancelled excluded). */
  issuedFc: number;
  paidFc: number;
  outstandingFc: number;
  /** Outstanding on obligations whose due date is before `asOf`. */
  lateFc: number;
  pill: BalancePill;
}

export function summarizeBalance(obligations: ObligationLike[], asOf: string): Balance {
  let issuedFc = 0;
  let paidFc = 0;
  let lateFc = 0;
  for (const o of obligations) {
    if (o.status === "waived" || o.status === "cancelled") continue;
    const total = o.amountFc + o.penaltyFc;
    const paid = Math.min(o.paidFc, total);
    issuedFc += total;
    paidFc += paid;
    if (o.dueDate < asOf) lateFc += total - paid;
  }
  const outstandingFc = issuedFc - paidFc;
  const pill: BalancePill = lateFc > 0 ? "late" : outstandingFc > 0 ? "due" : "paid";
  return { issuedFc, paidFc, outstandingFc, lateFc, pill };
}
