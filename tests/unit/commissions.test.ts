import { describe, expect, it } from "vitest";

import { computeLines, emptyTotals, totalsOf, type LineDraft } from "@/lib/commissions/compute";
import { formatRateBp, formatSignedFC } from "@/lib/commissions/format";
import { isPeriod, periodOf, periodRange, previousPeriod } from "@/lib/commissions/period";
import { commissionAmount, ruleFor, type RuleLike } from "@/lib/commissions/rules";
import { canEditCommissionRules, canManageCommissions } from "@/lib/identity/roles";

const rule = (
  id: string,
  basis: RuleLike["basis"],
  from: string,
  extra: Partial<RuleLike> = {},
): RuleLike => ({
  id,
  basis,
  rateBp: basis === "collection_percent" ? 500 : 0,
  amountFc: basis === "registration_fixed" ? 500 : 0,
  taxRuleId: null,
  effectiveFrom: from,
  effectiveTo: null,
  ...extra,
});

const rules: RuleLike[] = [
  rule("pct-2026", "collection_percent", "2026-01-01"),
  rule("pct-2027", "collection_percent", "2027-01-01", { rateBp: 600 }),
  rule("fix-2026", "registration_fixed", "2026-01-01"),
  rule("fix-ended", "registration_fixed", "2025-01-01", {
    amountFc: 300,
    effectiveTo: "2026-01-01",
  }),
];

describe("ruleFor: the latest rule effective on the act's business day (D36, invariant 6)", () => {
  it("picks the latest started version and ignores future ones", () => {
    expect(ruleFor(rules, "collection_percent", "2026-09-15")?.id).toBe("pct-2026");
    expect(ruleFor(rules, "collection_percent", "2026-12-31")?.id).toBe("pct-2026");
    expect(ruleFor(rules, "collection_percent", "2027-01-01")?.id).toBe("pct-2027");
    expect(ruleFor(rules, "collection_percent", "2025-12-31")).toBeNull();
  });
  it("ignores versions that ended and only matches the basis asked", () => {
    expect(ruleFor(rules, "registration_fixed", "2025-06-01")?.id).toBe("fix-ended");
    expect(ruleFor(rules, "registration_fixed", "2026-01-01")?.id).toBe("fix-2026");
    expect(ruleFor(rules, "registration_fixed", "2026-09-15")?.amountFc).toBe(500);
    expect(ruleFor([], "collection_percent", "2026-09-15")).toBeNull();
  });
  it("prefers a rule bound to the act's tax over a global one", () => {
    const withTax = [
      ...rules,
      rule("pct-tax", "collection_percent", "2026-01-01", { rateBp: 800, taxRuleId: "tax-a" }),
    ];
    expect(ruleFor(withTax, "collection_percent", "2026-09-15", "tax-a")?.id).toBe("pct-tax");
    expect(ruleFor(withTax, "collection_percent", "2026-09-15", "tax-b")?.id).toBe("pct-2026");
    expect(ruleFor(withTax, "collection_percent", "2026-09-15")?.id).toBe("pct-2026");
    const reversed = [...withTax].reverse();
    expect(ruleFor(reversed, "collection_percent", "2026-09-15", "tax-a")?.id).toBe("pct-tax");
  });
});

describe("commissionAmount: integer FC, half up (D22)", () => {
  it("rounds half up to the franc", () => {
    expect(commissionAmount(5000, 500)).toBe(250);
    expect(commissionAmount(4999, 500)).toBe(250); // 249.95
    expect(commissionAmount(10, 500)).toBe(1); // 0.5 → 1
    expect(commissionAmount(30, 500)).toBe(2); // 1.5 → 2
    expect(commissionAmount(9, 500)).toBe(0); // 0.45 → 0
    expect(commissionAmount(10500, 500)).toBe(525);
    expect(commissionAmount(0, 500)).toBe(0);
    expect(commissionAmount(5000, 0)).toBe(0);
  });
  it("refuses non-integers and negatives (invariant 9)", () => {
    expect(() => commissionAmount(10.5, 500)).toThrow(TypeError);
    expect(() => commissionAmount(-1, 500)).toThrow(RangeError);
  });
});

describe("computeLines: acts → signed lines and totals", () => {
  it("yields zero totals for a month with nothing", () => {
    const r = computeLines({ rules, collections: [], reversals: [], registrations: [] });
    expect(r.lines).toEqual([]);
    expect(r.totals).toEqual(emptyTotals());
    expect(totalsOf([])).toEqual(emptyTotals());
  });

  it("pays each collection at the rule of its day and each registration the fixed amount", () => {
    const r = computeLines({
      rules,
      collections: [
        { paymentId: "p1", businessDate: "2026-09-04", amountFc: 5000, taxRuleId: null },
        { paymentId: "p2", businessDate: "2026-09-13", amountFc: 10500, taxRuleId: null },
        { paymentId: "p3", businessDate: "2026-09-13", amountFc: 4999, taxRuleId: null },
      ],
      reversals: [],
      registrations: [
        { taxpayerId: "t1", businessDate: "2026-09-02" },
        { taxpayerId: "t2", businessDate: "2026-09-02" },
      ],
    });
    expect(r.lines.map((l) => l.businessDate)).toEqual([
      "2026-09-02",
      "2026-09-02",
      "2026-09-04",
      "2026-09-13",
      "2026-09-13",
    ]);
    expect(r.lines.find((l) => l.paymentId === "p3")).toMatchObject({
      kind: "collection",
      ruleId: "pct-2026",
      baseFc: 4999,
      rateBp: 500,
      amountFc: 250,
    });
    expect(r.totals).toEqual({
      collectionsCount: 3,
      collectedFc: 20499,
      collectionCommissionFc: 250 + 525 + 250,
      registrationsCount: 2,
      registrationCommissionFc: 1000,
      totalFc: 2025,
    });
  });

  it("makes a negative line for a reversal, mirroring what the collection earned", () => {
    // Same-month reversal: the computed collection line is negated (net 0).
    const same = computeLines({
      rules,
      collections: [
        { paymentId: "p1", businessDate: "2026-09-04", amountFc: 8000, taxRuleId: null },
      ],
      reversals: [
        {
          paymentId: "p1",
          businessDate: "2026-09-20",
          collectedOn: "2026-09-04",
          amountFc: 8000,
          taxRuleId: null,
          priorLine: null,
        },
      ],
      registrations: [],
    });
    expect(same.lines.map((l) => [l.kind, l.amountFc])).toEqual([
      ["collection", 400],
      ["reversal", -400],
    ]);
    expect(same.totals).toMatchObject({
      collectionsCount: 1,
      collectedFc: 8000,
      collectionCommissionFc: 0,
      totalFc: 0,
    });
    // Reversal of a collection frozen in an earlier statement: the stored line is negated.
    const prior = computeLines({
      rules,
      collections: [],
      reversals: [
        {
          paymentId: "p0",
          businessDate: "2026-10-02",
          collectedOn: "2026-08-30",
          amountFc: 8000,
          taxRuleId: null,
          priorLine: { ruleId: "pct-old", baseFc: 8000, rateBp: 450, amountFc: 360 },
        },
      ],
      registrations: [],
    });
    expect(prior.lines[0]).toMatchObject({
      kind: "reversal",
      ruleId: "pct-old",
      rateBp: 450,
      amountFc: -360,
    });
    expect(prior.totals.totalFc).toBe(-360);
    // No stored line: the rule of the collection day applies, not the reversal day's.
    const recomputed = computeLines({
      rules,
      collections: [],
      reversals: [
        {
          paymentId: "p9",
          businessDate: "2027-01-05",
          collectedOn: "2026-12-20",
          amountFc: 10000,
          taxRuleId: null,
          priorLine: null,
        },
      ],
      registrations: [],
    });
    expect(recomputed.lines[0]).toMatchObject({ ruleId: "pct-2026", rateBp: 500, amountFc: -500 });
  });

  it("earns nothing when no rule is effective on the day", () => {
    const r = computeLines({
      rules,
      collections: [
        { paymentId: "p1", businessDate: "2025-06-01", amountFc: 5000, taxRuleId: null },
      ],
      reversals: [],
      registrations: [{ taxpayerId: "t1", businessDate: "2024-06-01" }],
    });
    expect(r.lines.map((l) => l.amountFc)).toEqual([0, 0]);
    expect(r.totals.totalFc).toBe(0);
  });

  it("totalsOf nets reversals into the collection commission", () => {
    const lines: LineDraft[] = [
      {
        kind: "collection",
        ruleId: "r",
        paymentId: "a",
        taxpayerId: null,
        businessDate: "2026-09-01",
        baseFc: 5000,
        rateBp: 500,
        amountFc: 250,
      },
      {
        kind: "reversal",
        ruleId: "r",
        paymentId: "b",
        taxpayerId: null,
        businessDate: "2026-09-02",
        baseFc: 8000,
        rateBp: 500,
        amountFc: -400,
      },
    ];
    expect(totalsOf(lines)).toEqual({
      collectionsCount: 1,
      collectedFc: 5000,
      collectionCommissionFc: -150,
      registrationsCount: 0,
      registrationCommissionFc: 0,
      totalFc: -150,
    });
  });
});

describe("periods (Africa/Lubumbashi)", () => {
  it("derives the month from the business day and walks back", () => {
    expect(periodOf(new Date("2026-09-30T22:30:00Z"))).toBe("2026-10");
    expect(periodOf(new Date("2026-09-30T21:59:00Z"))).toBe("2026-09");
    expect(periodRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(previousPeriod("2026-01")).toBe("2025-12");
    expect(previousPeriod("2026-09")).toBe("2026-08");
    expect(isPeriod("2026-13")).toBe(false);
    expect(isPeriod("2026-09")).toBe(true);
    expect(() => periodRange("2026-9")).toThrow();
  });
});

describe("formatting and roles", () => {
  it("formats signed amounts and basis points in French", () => {
    expect(formatSignedFC(1250)).toBe("1 250 FC");
    expect(formatSignedFC(-400)).toBe("−400 FC");
    expect(formatSignedFC(0)).toBe("0 FC");
    expect(formatRateBp(500)).toBe("5 %");
    expect(formatRateBp(525)).toBe("5,25 %");
    expect(formatRateBp(50)).toBe("0,5 %");
  });
  it("Finances and the Administrateur manage statements; only the Administrateur edits the scale", () => {
    expect(canManageCommissions("finances")).toBe(true);
    expect(canManageCommissions("administrateur")).toBe(true);
    expect(canManageCommissions("superviseur")).toBe(false);
    expect(canManageCommissions("auditeur")).toBe(false);
    expect(canManageCommissions("maire")).toBe(false);
    expect(canEditCommissionRules("administrateur")).toBe(true);
    expect(canEditCommissionRules("finances")).toBe(false);
  });
});
