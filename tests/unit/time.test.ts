import { describe, expect, it } from "vitest";

import {
  businessDate,
  businessYear,
  daysBetween,
  daysLate,
  monthPeriod,
  monthPeriodOf,
  yymm,
} from "@/lib/time";

describe("lib/time (Africa/Lubumbashi, UTC+2)", () => {
  it("assigns 00:30 local on 1 October to 1 October", () => {
    expect(businessDate(new Date("2026-10-01T00:30:00+02:00"))).toBe("2026-10-01");
  });

  it("assigns 22:30 UTC on 30 September to 1 October", () => {
    const at = new Date("2026-09-30T22:30:00Z");
    expect(businessDate(at)).toBe("2026-10-01");
    expect(yymm(at)).toBe("2610");
    expect(businessYear(new Date("2026-12-31T22:30:00Z"))).toBe(2027);
  });

  it("keeps 21:59 UTC on 30 September in September", () => {
    expect(businessDate(new Date("2026-09-30T21:59:00Z"))).toBe("2026-09-30");
    expect(yymm(new Date("2026-09-30T21:59:00Z"))).toBe("2609");
  });

  it("builds the month period with the last day as due date", () => {
    expect(monthPeriod(new Date("2026-09-15T10:00:00+02:00"))).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
      dueDate: "2026-09-30",
    });
    expect(monthPeriodOf(2028, 2).end).toBe("2028-02-29");
    expect(monthPeriodOf(2026, 12).dueDate).toBe("2026-12-31");
  });

  it("counts days late from a due date", () => {
    expect(daysLate("2026-08-31", "2026-09-13")).toBe(13);
    expect(daysLate("2026-09-30", "2026-09-13")).toBe(0);
    expect(daysBetween("2026-01-01", "2025-12-31")).toBe(-1);
  });
});
