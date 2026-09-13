import { describe, expect, it } from "vitest";

import { collectionRate, shares } from "@/lib/admin/stats";

describe("dashboard arithmetic", () => {
  it("rounds the collection rate to a whole percentage and survives zero", () => {
    expect(collectionRate(6_900_000, 21_600_000)).toBe(32);
    expect(collectionRate(0, 0)).toBe(0);
    expect(collectionRate(5, 0)).toBe(0);
    expect(collectionRate(10_500, 10_500)).toBe(100);
  });
  it("computes channel shares that describe the total", () => {
    const s = shares([
      { key: "mpesa", amountFc: 54 },
      { key: "airtel", amountFc: 31 },
      { key: "orange", amountFc: 11 },
      { key: "tpe", amountFc: 4 },
    ]);
    expect(s.map((x) => x.pct)).toEqual([54, 31, 11, 4]);
    expect(shares([])).toEqual([]);
    expect(shares([{ key: "x", amountFc: 0 }])[0]?.pct).toBe(0);
  });
});
