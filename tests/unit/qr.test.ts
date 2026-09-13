import { describe, expect, it } from "vitest";

import { parseScannedTaxpayerNo, qrPayloadFor } from "@/lib/census/qr";

describe("QR payloads", () => {
  it("encodes a portal URL carrying the municipal ID", () => {
    expect(qrPayloadFor("LUB-KAM-00000125", "https://recouvrement.lubumbashi.cd/")).toBe(
      "https://recouvrement.lubumbashi.cd/q/LUB-KAM-00000125",
    );
  });
  it("parses a bare ID, a URL, or a hardware scanner's typed line", () => {
    expect(parseScannedTaxpayerNo("LUB-KAM-00000125")).toBe("LUB-KAM-00000125");
    expect(parseScannedTaxpayerNo("https://x.cd/q/LUB-KAM-00000125?utm=1")).toBe(
      "LUB-KAM-00000125",
    );
    expect(parseScannedTaxpayerNo("  LUB-KAM-00000125\n")).toBe("LUB-KAM-00000125");
    expect(parseScannedTaxpayerNo("LUB-KAM-125")).toBeNull();
    expect(parseScannedTaxpayerNo("hello")).toBeNull();
  });
});
