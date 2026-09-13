import { describe, expect, it } from "vitest";

import { formatReceiptNo, formatTaxpayerId, parseTaxpayerId } from "@/lib/identity/ids";

describe("taxpayer ids", () => {
  it("formats LUB-<code>-<8 digits>", () => {
    expect(formatTaxpayerId("KAM", 125)).toBe("LUB-KAM-00000125");
    expect(formatTaxpayerId("ANN", 99_999_999)).toBe("LUB-ANN-99999999");
  });

  it("parses and round-trips", () => {
    expect(parseTaxpayerId("LUB-KAM-00000125")).toEqual({ communeCode: "KAM", n: 125 });
    expect(parseTaxpayerId("LUB-KAM-000000125")).toBeNull();
    expect(parseTaxpayerId("lub-kam-00000125")).toBeNull();
  });

  it("rejects bad codes and sequences", () => {
    expect(() => formatTaxpayerId("Kam", 1)).toThrow(TypeError);
    expect(() => formatTaxpayerId("KAM", 0)).toThrow(RangeError);
    expect(() => formatTaxpayerId("KAM", 100_000_000)).toThrow(RangeError);
  });
});

describe("receipt numbers", () => {
  it("uses the business month in the prefix", () => {
    expect(formatReceiptNo(new Date("2026-09-13T08:44:00+02:00"), 287)).toBe("RCP-2609-000287");
    expect(formatReceiptNo(new Date("2026-09-30T22:30:00Z"), 1)).toBe("RCP-2610-000001");
  });
});
