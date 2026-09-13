import { describe, expect, it } from "vitest";

import {
  matchStatement,
  type PlatformPayment,
  type StatementRow,
} from "@/lib/reconciliation/match";

const pay = (
  n: number,
  amountFc: number,
  status: PlatformPayment["status"] = "confirmed",
  providerReference: string | null = `MK${n}`,
): PlatformPayment => ({ id: `p${n}`, reference: `TX-${n}`, providerReference, amountFc, status });
const line = (
  index: number,
  providerReference: string,
  platformReference: string | null,
  amountFc: number,
): StatementRow => ({
  index,
  providerReference,
  platformReference,
  amountFc,
});

describe("reconciliation matching (M9)", () => {
  it("matches by platform reference or provider reference, once", () => {
    const r = matchStatement(
      [pay(1, 5000), pay(2, 25000, "confirmed", null)],
      [line(0, "MK1", "TX-1", 5000), line(1, "AM-9", "TX-2", 25000)],
    );
    expect(r.exceptions).toEqual([]);
    expect(r.matches).toEqual([
      { lineIndex: 0, paymentId: "p1" },
      { lineIndex: 1, paymentId: "p2" },
    ]);
    expect(r.summary).toEqual({
      platformCount: 2,
      platformTotalFc: 30000,
      statementCount: 2,
      statementTotalFc: 30000,
      matchedCount: 2,
    });
  });

  it("flags the five exception types", () => {
    const r = matchStatement(
      [
        pay(1, 5000),
        pay(2, 25000),
        pay(3, 7000),
        pay(4, 9000, "failed"),
        pay(5, 1000, "expired", null),
      ],
      [
        // p1 absent → missing_at_provider
        line(0, "MK2", "TX-2", 25000),
        line(1, "MK2-DUP", "TX-2", 25000), // duplicate_at_provider
        line(2, "MK3", "TX-3", 6000), // amount_mismatch
        line(3, "MK4", "TX-4", 9000), // status_mismatch (platform says failed)
        line(4, "AM-77120394", null, 5000), // missing_on_platform
      ],
    );
    expect(r.matches).toEqual([{ lineIndex: 0, paymentId: "p2" }]);
    expect(r.exceptions.map((e) => e.type).sort()).toEqual(
      [
        "amount_mismatch",
        "duplicate_at_provider",
        "missing_at_provider",
        "missing_on_platform",
        "status_mismatch",
      ].sort(),
    );
    expect(r.exceptions.find((e) => e.type === "missing_at_provider")).toEqual({
      type: "missing_at_provider",
      paymentId: "p1",
      platformAmountFc: 5000,
    });
    expect(r.exceptions.find((e) => e.type === "duplicate_at_provider")).toMatchObject({
      paymentId: "p2",
      lineIndex: 1,
    });
    expect(r.exceptions.find((e) => e.type === "amount_mismatch")).toMatchObject({
      paymentId: "p3",
      lineIndex: 2,
      platformAmountFc: 7000,
      statementAmountFc: 6000,
    });
    expect(r.exceptions.find((e) => e.type === "status_mismatch")).toMatchObject({
      paymentId: "p4",
      lineIndex: 3,
    });
    expect(r.exceptions.find((e) => e.type === "missing_on_platform")).toMatchObject({
      lineIndex: 4,
      statementAmountFc: 5000,
    });
    // Only confirmed payments count as platform transactions; failed and expired ones do not.
    expect(r.summary.platformCount).toBe(3);
    expect(r.summary.platformTotalFc).toBe(37000);
    expect(r.summary.matchedCount).toBe(1);
  });

  it("a line reachable by both references is counted once; an unconfirmed payment without lines is silent", () => {
    const r = matchStatement(
      [pay(1, 5000), pay(9, 100, "pending")],
      [line(0, "MK1", "TX-1", 5000)],
    );
    expect(r.matches).toHaveLength(1);
    expect(r.exceptions).toEqual([]);
  });

  it("empty day", () => {
    const r = matchStatement([], []);
    expect(r).toEqual({
      matches: [],
      exceptions: [],
      summary: {
        platformCount: 0,
        platformTotalFc: 0,
        statementCount: 0,
        statementTotalFc: 0,
        matchedCount: 0,
      },
    });
  });
});
