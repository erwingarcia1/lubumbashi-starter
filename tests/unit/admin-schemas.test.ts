import { describe, expect, it } from "vitest";

import { proposeVersionInput } from "@/lib/admin/taxes";
import { changeCategoryInput, updateContactInput } from "@/lib/admin/taxpayers";

describe("admin action contracts", () => {
  it("proposeVersion requires integer FC amounts and an ISO date", () => {
    expect(
      proposeVersionInput.safeParse({
        ruleCode: "x",
        amountFc: 5000,
        effectiveFrom: "2026-10-01",
        penaltyRateBp: 1000,
        graceDays: 30,
      }).success,
    ).toBe(true);
    expect(
      proposeVersionInput.safeParse({
        ruleCode: "x",
        amountFc: 5000.5,
        effectiveFrom: "2026-10-01",
        penaltyRateBp: null,
        graceDays: 30,
      }).success,
    ).toBe(false);
    expect(
      proposeVersionInput.safeParse({
        ruleCode: "x",
        amountFc: -1,
        effectiveFrom: "2026-10-01",
        penaltyRateBp: null,
        graceDays: 30,
      }).success,
    ).toBe(false);
    expect(
      proposeVersionInput.safeParse({
        ruleCode: "x",
        amountFc: 5000,
        effectiveFrom: "01/10/2026",
        penaltyRateBp: null,
        graceDays: 30,
      }).success,
    ).toBe(false);
  });
  it("contact update requires an E.164 phone; category change requires a reason", () => {
    expect(
      updateContactInput.safeParse({
        taxpayerNo: "LUB-KAM-00000125",
        phone: "+243994128830",
        address: "Av. Kasaï 214",
      }).success,
    ).toBe(true);
    expect(
      updateContactInput.safeParse({
        taxpayerNo: "LUB-KAM-00000125",
        phone: "0994128830",
        address: "Av. Kasaï 214",
      }).success,
    ).toBe(false);
    expect(
      changeCategoryInput.safeParse({
        entityId: "3f2b7a1c-9d0e-4c5a-8b6d-1e2f3a4b5c6d",
        categoryCode: "commerce",
        reason: "abc",
      }).success,
    ).toBe(false);
    expect(
      changeCategoryInput.safeParse({
        entityId: "3f2b7a1c-9d0e-4c5a-8b6d-1e2f3a4b5c6d",
        categoryCode: "commerce",
        reason: "Erreur de saisie",
      }).success,
    ).toBe(true);
  });
});
