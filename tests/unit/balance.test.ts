import { describe, expect, it } from "vitest";

import { summarizeBalance, type ObligationLike } from "@/lib/registry/balance";

const o = (over: Partial<ObligationLike>): ObligationLike => ({
  status: "due",
  amountFc: 5000,
  penaltyFc: 0,
  paidFc: 0,
  dueDate: "2026-09-30",
  ...over,
});

describe("summarizeBalance", () => {
  it("is up to date when everything counted is paid", () => {
    const b = summarizeBalance(
      [o({ status: "paid", paidFc: 5000, dueDate: "2026-08-31" })],
      "2026-09-13",
    );
    expect(b).toEqual({ issuedFc: 5000, paidFc: 5000, outstandingFc: 0, lateFc: 0, pill: "paid" });
  });
  it("is 'due' for an unpaid current period and 'late' once the due date has passed", () => {
    expect(summarizeBalance([o({})], "2026-09-13").pill).toBe("due");
    const late = summarizeBalance([o({ dueDate: "2026-08-31" }), o({})], "2026-09-13");
    expect(late).toEqual({
      issuedFc: 10000,
      paidFc: 0,
      outstandingFc: 10000,
      lateFc: 5000,
      pill: "late",
    });
  });
  it("counts penalties, caps paid at the total and ignores waived and cancelled obligations", () => {
    const b = summarizeBalance(
      [
        o({ status: "partially_paid", penaltyFc: 500, paidFc: 2000, dueDate: "2026-07-31" }),
        o({ status: "paid", paidFc: 9999, dueDate: "2026-06-30" }),
        o({ status: "waived", dueDate: "2026-05-31" }),
        o({ status: "cancelled", dueDate: "2026-04-30" }),
      ],
      "2026-09-13",
    );
    expect(b).toEqual({
      issuedFc: 10500,
      paidFc: 7000,
      outstandingFc: 3500,
      lateFc: 3500,
      pill: "late",
    });
  });
});
