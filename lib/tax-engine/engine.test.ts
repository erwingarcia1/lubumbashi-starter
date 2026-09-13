import { describe, expect, it } from "vitest";

import {
  allocatePayment,
  amountFor,
  applicableRules,
  applyBp,
  computeObligations,
  computePenalty,
  dueDateFor,
  isExempt,
  obligationStatus,
  periodsBetween,
  roundFc,
  versionFor,
  type EntityInput,
  type Rule,
  type RuleVersion,
} from "@/lib/tax-engine";

const version = (
  over: Partial<RuleVersion> & Pick<RuleVersion, "id" | "taxRuleId">,
): RuleVersion => ({
  version: 1,
  status: "approved",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  calcKind: "fixed",
  amountFc: 5000,
  rateBp: null,
  frequency: "monthly",
  dueDay: null,
  penaltyKind: "once_percent",
  penaltyRateBp: 1000,
  penaltyAmountFc: null,
  graceDays: 30,
  penaltyCapBp: 10_000,
  ...over,
});

const menage: Rule = {
  id: "r-menage",
  code: "assainissement_menage",
  taxCode: "assainissement",
  categoryId: "cat-menage",
  active: true,
  versions: [version({ id: "v1", taxRuleId: "r-menage", effectiveFrom: "2026-06-01" })],
};
const etalage: Rule = {
  id: "r-etalage",
  code: "etalage",
  taxCode: "etalage",
  categoryId: "cat-etal",
  active: true,
  versions: [
    version({
      id: "v-et",
      taxRuleId: "r-etalage",
      effectiveFrom: "2026-06-01",
      amountFc: 15000,
      penaltyKind: "none",
    }),
  ],
};
const patente: Rule = {
  id: "r-patente",
  code: "patente",
  taxCode: "patente",
  categoryId: "cat-menage",
  active: true,
  versions: [
    version({
      id: "v-pat",
      taxRuleId: "r-patente",
      amountFc: 50000,
      frequency: "annual",
      penaltyKind: "monthly_percent",
      penaltyRateBp: 500,
    }),
  ],
};
const inactive: Rule = {
  ...etalage,
  id: "r-old",
  code: "old",
  active: false,
  categoryId: "cat-menage",
};

const entity: EntityInput = {
  id: "e1",
  categoryId: "cat-menage",
  taxBaseFc: null,
  registeredAt: new Date("2026-06-02T10:22:00+02:00"),
  active: true,
};
const asOf = new Date("2026-09-13T08:42:00+02:00");

describe("rounding (invariant 9)", () => {
  it("rounds half up to the franc and applies basis points", () => {
    expect(roundFc(12.5)).toBe(13);
    expect(roundFc(12.4)).toBe(12);
    expect(roundFc(0)).toBe(0);
    expect(applyBp(12345, 1000)).toBe(1235); // 1234.5 → 1235
    expect(applyBp(150000, 50)).toBe(750);
    expect(() => roundFc(-1)).toThrow(RangeError);
    expect(() => roundFc(Number.NaN)).toThrow(RangeError);
  });
});

describe("periods", () => {
  it("lists monthly periods across a year boundary", () => {
    const p = periodsBetween("monthly", { year: 2026, month: 11 }, { year: 2027, month: 1 });
    expect(p.map((x) => x.start)).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
    expect(p[1]?.end).toBe("2026-12-31");
  });
  it("lists quarterly and annual periods", () => {
    const q = periodsBetween("quarterly", { year: 2026, month: 8 }, { year: 2027, month: 2 });
    expect(q.map((x) => [x.start, x.end])).toEqual([
      ["2026-07-01", "2026-09-30"],
      ["2026-10-01", "2026-12-31"],
      ["2027-01-01", "2027-03-31"],
    ]);
    expect(
      periodsBetween("annual", { year: 2026, month: 7 }, { year: 2027, month: 1 }).map(
        (x) => x.dueDate,
      ),
    ).toEqual(["2026-12-31", "2027-12-31"]);
  });
  it("returns nothing when the range is inverted", () => {
    expect(periodsBetween("monthly", { year: 2026, month: 9 }, { year: 2026, month: 8 })).toEqual(
      [],
    );
  });
  it("computes due dates with and without a due day, clamped to the month", () => {
    const sept = { start: "2026-09-01", end: "2026-09-30", dueDate: "2026-09-30" };
    expect(dueDateFor(sept, null)).toBe("2026-09-30");
    expect(dueDateFor(sept, 15)).toBe("2026-09-15");
    expect(dueDateFor(sept, 31)).toBe("2026-09-30");
  });
});

describe("rules and versions (invariant 6)", () => {
  it("applies category rules plus includes minus excludes, ignoring inactive rules", () => {
    const rules = [menage, etalage, patente, inactive];
    expect(applicableRules(entity, rules, []).map((r) => r.id)).toEqual(["r-menage", "r-patente"]);
    expect(
      applicableRules(entity, rules, [
        { taxRuleId: "r-etalage", kind: "include" },
        { taxRuleId: "r-patente", kind: "exclude" },
      ]).map((r) => r.id),
    ).toEqual(["r-menage", "r-etalage"]);
  });
  it("picks the latest effective non-draft version and none before the first", () => {
    const rule: Rule = {
      ...menage,
      versions: [
        version({
          id: "v1",
          taxRuleId: "r-menage",
          effectiveFrom: "2026-06-01",
          effectiveTo: "2026-10-01",
          amountFc: 5000,
          status: "superseded",
        }),
        version({
          id: "v2",
          taxRuleId: "r-menage",
          version: 2,
          effectiveFrom: "2026-10-01",
          amountFc: 6000,
        }),
        version({
          id: "v3",
          taxRuleId: "r-menage",
          version: 3,
          effectiveFrom: "2027-01-01",
          amountFc: 7000,
          status: "draft",
        }),
      ],
    };
    expect(versionFor(rule, "2026-05-01")).toBeNull();
    expect(versionFor(rule, "2026-09-01")?.id).toBe("v1");
    expect(versionFor(rule, "2026-10-01")?.id).toBe("v2");
    expect(versionFor(rule, "2027-02-01")?.id).toBe("v2");
  });
  it("keeps the later version when versions are listed out of order", () => {
    const rule: Rule = {
      ...menage,
      versions: [
        version({ id: "v2", taxRuleId: "r-menage", version: 2, effectiveFrom: "2026-10-01" }),
        version({
          id: "v1",
          taxRuleId: "r-menage",
          effectiveFrom: "2026-06-01",
          status: "superseded",
        }),
      ],
    };
    expect(versionFor(rule, "2026-11-01")?.id).toBe("v2");
  });
});

describe("computeObligations", () => {
  it("issues one obligation per period from registration to asOf, frozen to the version in force", () => {
    const { obligations, skipped } = computeObligations({ entity, rules: [menage], asOf });
    expect(skipped).toEqual([]);
    expect(
      obligations.map((o) => [o.periodStart, o.dueDate, o.amountFc, o.taxRuleVersionId]),
    ).toEqual([
      ["2026-06-01", "2026-06-30", 5000, "v1"],
      ["2026-07-01", "2026-07-31", 5000, "v1"],
      ["2026-08-01", "2026-08-31", 5000, "v1"],
      ["2026-09-01", "2026-09-30", 5000, "v1"],
    ]);
  });
  it("applies a rate change mid-year: old periods keep the old version and amount", () => {
    const rule: Rule = {
      ...menage,
      versions: [
        version({
          id: "v1",
          taxRuleId: "r-menage",
          effectiveFrom: "2026-06-01",
          effectiveTo: "2026-08-01",
          status: "superseded",
        }),
        version({
          id: "v2",
          taxRuleId: "r-menage",
          version: 2,
          effectiveFrom: "2026-08-01",
          amountFc: 6000,
        }),
      ],
    };
    const { obligations } = computeObligations({ entity, rules: [rule], asOf });
    expect(obligations.map((o) => [o.periodStart, o.amountFc, o.taxRuleVersionId])).toEqual([
      ["2026-06-01", 5000, "v1"],
      ["2026-07-01", 5000, "v1"],
      ["2026-08-01", 6000, "v2"],
      ["2026-09-01", 6000, "v2"],
    ]);
  });
  it("skips periods before the first version and exempt periods, and annual rules use the calendar year", () => {
    const late = { ...entity, registeredAt: new Date("2026-05-15T09:00:00+02:00") };
    const { obligations, skipped } = computeObligations({
      entity: late,
      rules: [menage, patente],
      exemptions: [{ taxRuleId: "r-menage", validFrom: "2026-07-01", validTo: "2026-07-31" }],
      asOf,
    });
    expect(skipped).toEqual([
      { taxRuleId: "r-menage", periodStart: "2026-05-01", reason: "no_version" },
      { taxRuleId: "r-menage", periodStart: "2026-07-01", reason: "exempt" },
    ]);
    expect(obligations.filter((o) => o.taxRuleId === "r-patente")).toEqual([
      {
        entityId: "e1",
        taxRuleId: "r-patente",
        taxRuleVersionId: "v-pat",
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        dueDate: "2026-12-31",
        amountFc: 50000,
      },
    ]);
    expect(obligations.filter((o) => o.taxRuleId === "r-menage").map((o) => o.periodStart)).toEqual(
      ["2026-06-01", "2026-08-01", "2026-09-01"],
    );
  });
  it("exempts every tax when the exemption has no rule, honouring validity dates", () => {
    expect(
      isExempt([{ taxRuleId: null, validFrom: "2026-01-01", validTo: null }], "any", "2026-09-01"),
    ).toBe(true);
    expect(
      isExempt([{ taxRuleId: null, validFrom: "2026-10-01", validTo: null }], "any", "2026-09-01"),
    ).toBe(false);
    expect(
      isExempt(
        [{ taxRuleId: "other", validFrom: "2026-01-01", validTo: null }],
        "any",
        "2026-09-01",
      ),
    ).toBe(false);
  });
  it("computes percentage rules from the entity's tax base and skips entities without one", () => {
    const immo: Rule = {
      id: "r-immo",
      code: "immobiliere",
      taxCode: "immobiliere",
      categoryId: "cat-prop",
      active: true,
      versions: [
        version({
          id: "v-immo",
          taxRuleId: "r-immo",
          calcKind: "percent_of_base",
          amountFc: null,
          rateBp: 50,
          frequency: "annual",
          penaltyKind: "none",
        }),
      ],
    };
    const withBase: EntityInput = { ...entity, categoryId: "cat-prop", taxBaseFc: 12_345_678 };
    expect(amountFor(immo.versions[0]!, withBase)).toBe(61728); // 61 728.39 → 61 728
    const ok = computeObligations({ entity: withBase, rules: [immo], asOf });
    expect(ok.obligations[0]?.amountFc).toBe(61728);
    const noBase = computeObligations({
      entity: { ...withBase, taxBaseFc: null },
      rules: [immo],
      asOf,
    });
    expect(noBase.obligations).toEqual([]);
    expect(noBase.skipped[0]?.reason).toBe("no_tax_base");
    expect(amountFor(version({ id: "x", taxRuleId: "r", amountFc: null }), entity)).toBe(0);
    expect(
      amountFor(
        version({ id: "y", taxRuleId: "r", calcKind: "percent_of_base", rateBp: null }),
        withBase,
      ),
    ).toBe(0);
  });
  it("applies entity overrides when computing (include étalage, exclude patente)", () => {
    const { obligations } = computeObligations({
      entity,
      rules: [menage, etalage, patente],
      overrides: [
        { taxRuleId: "r-etalage", kind: "include" },
        { taxRuleId: "r-patente", kind: "exclude" },
      ],
      asOf,
    });
    expect(new Set(obligations.map((o) => o.taxRuleId))).toEqual(
      new Set(["r-menage", "r-etalage"]),
    );
    expect(obligations.filter((o) => o.taxRuleId === "r-etalage").map((o) => o.amountFc)).toEqual([
      15000, 15000, 15000, 15000,
    ]);
  });
  it("produces nothing for an inactive entity and defaults to monthly when a rule has no versions", () => {
    expect(
      computeObligations({ entity: { ...entity, active: false }, rules: [menage], asOf })
        .obligations,
    ).toEqual([]);
    const bare: Rule = { ...menage, versions: [] };
    const r = computeObligations({ entity, rules: [bare], asOf });
    expect(r.obligations).toEqual([]);
    expect(r.skipped).toHaveLength(4);
  });
  it("respects the month boundary in Africa/Lubumbashi (23:59 vs 00:01 on 30 September)", () => {
    const before = computeObligations({
      entity,
      rules: [menage],
      asOf: new Date("2026-09-30T21:59:00Z"),
    });
    const after = computeObligations({
      entity,
      rules: [menage],
      asOf: new Date("2026-09-30T22:01:00Z"),
    });
    expect(before.obligations.at(-1)?.periodStart).toBe("2026-09-01");
    expect(after.obligations.at(-1)?.periodStart).toBe("2026-10-01");
    const registeredJustAfterMidnight = {
      ...entity,
      registeredAt: new Date("2026-06-30T22:30:00Z"),
    };
    expect(
      computeObligations({ entity: registeredJustAfterMidnight, rules: [menage], asOf })
        .obligations[0]?.periodStart,
    ).toBe("2026-07-01");
  });
});

describe("computePenalty", () => {
  const due = { dueDate: "2026-08-31", amountFc: 5000 };
  it("charges nothing within the grace period or for rules without penalty", () => {
    expect(computePenalty(menage.versions[0]!, due, "2026-09-13")).toBe(0);
    expect(computePenalty(menage.versions[0]!, due, "2026-09-30")).toBe(0);
    expect(computePenalty(etalage.versions[0]!, due, "2027-01-01")).toBe(0);
  });
  it("charges a one-off percentage or fixed amount after the grace period", () => {
    expect(computePenalty(menage.versions[0]!, due, "2026-10-01")).toBe(500);
    expect(computePenalty(menage.versions[0]!, due, "2027-06-01")).toBe(500);
    expect(
      computePenalty(
        version({ id: "f", taxRuleId: "r", penaltyKind: "once_fixed", penaltyAmountFc: 750 }),
        due,
        "2026-10-01",
      ),
    ).toBe(750);
    expect(
      computePenalty(
        version({ id: "f0", taxRuleId: "r", penaltyKind: "once_fixed", penaltyAmountFc: null }),
        due,
        "2026-10-01",
      ),
    ).toBe(0);
    expect(
      computePenalty(version({ id: "p0", taxRuleId: "r", penaltyRateBp: null }), due, "2026-10-01"),
    ).toBe(0);
  });
  it("charges monthly percentages simply (not compounding) and caps them", () => {
    const monthly = patente.versions[0]!; // 5 % per started 30-day block after 30 days, cap 100 %
    expect(computePenalty(monthly, due, "2026-10-01")).toBe(250); // 1 block
    expect(computePenalty(monthly, due, "2026-10-30")).toBe(250); // still block 1 (day 60)
    expect(computePenalty(monthly, due, "2026-10-31")).toBe(500); // block 2
    expect(computePenalty(monthly, due, "2030-01-01")).toBe(5000); // capped at 100 %
    expect(
      computePenalty({ ...monthly, penaltyCapBp: null, penaltyRateBp: null }, due, "2030-01-01"),
    ).toBe(0);
    expect(computePenalty({ ...monthly, penaltyCapBp: 2000 }, due, "2027-06-01")).toBe(1000);
  });
});

describe("allocatePayment (D5: oldest first, principal before penalty)", () => {
  const obligations = [
    { id: "sept", dueDate: "2026-09-30", amountFc: 5000, penaltyFc: 0, paidFc: 0 },
    { id: "aug", dueDate: "2026-08-31", amountFc: 5000, penaltyFc: 500, paidFc: 0 },
    { id: "jul", dueDate: "2026-07-31", amountFc: 5000, penaltyFc: 0, paidFc: 5000 },
  ];
  it("settles the oldest unpaid obligation first and splits a partial payment", () => {
    expect(allocatePayment(3000, obligations)).toEqual({
      allocations: [{ obligationId: "aug", kind: "principal", amountFc: 3000 }],
      remainderFc: 0,
    });
    expect(allocatePayment(10000, obligations)).toEqual({
      allocations: [
        { obligationId: "aug", kind: "principal", amountFc: 5000 },
        { obligationId: "aug", kind: "penalty", amountFc: 500 },
        { obligationId: "sept", kind: "principal", amountFc: 4500 },
      ],
      remainderFc: 0,
    });
  });
  it("continues into penalties of a partially paid obligation and reports overpayment", () => {
    const partly = [
      { id: "aug", dueDate: "2026-08-31", amountFc: 5000, penaltyFc: 500, paidFc: 5200 },
    ];
    expect(allocatePayment(1000, partly)).toEqual({
      allocations: [{ obligationId: "aug", kind: "penalty", amountFc: 300 }],
      remainderFc: 700,
    });
    expect(allocatePayment(100, [])).toEqual({ allocations: [], remainderFc: 100 });
    expect(() => allocatePayment(0, obligations)).toThrow(RangeError);
    expect(() => allocatePayment(12.5, obligations)).toThrow(RangeError);
  });
  it("does not mutate its input and derives statuses", () => {
    const copy = structuredClone(obligations);
    allocatePayment(20000, obligations);
    expect(obligations).toEqual(copy);
    expect(obligationStatus({ amountFc: 5000, penaltyFc: 500, paidFc: 5500 })).toBe("paid");
    expect(obligationStatus({ amountFc: 5000, penaltyFc: 0, paidFc: 1 })).toBe("partially_paid");
    expect(obligationStatus({ amountFc: 5000, penaltyFc: 0, paidFc: 0 })).toBe("due");
  });
});
