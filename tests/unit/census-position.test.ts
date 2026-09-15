import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { manualPositionAllowed } from "@/lib/census/position";
import { censusInput } from "@/lib/census/schema";

const record = (gps: Record<string, unknown>) => ({
  clientUuid: randomUUID(),
  taxpayer: {
    kind: "person",
    fullName: "Test Position",
    phone: "+243990000779",
    communeCode: "KAM",
    quartierCode: "bel-air",
    address: "Av. Test 9",
  },
  entity: { kind: "property", categoryCode: "menage", name: "Résidence", gps },
});

describe("hand-placed census positions (D34 placeholder)", () => {
  it("are allowed outside production only", () => {
    for (const APP_ENV of ["development", "test", "demo"]) {
      expect(manualPositionAllowed({ APP_ENV }), APP_ENV).toBe(true);
    }
    expect(manualPositionAllowed({ APP_ENV: "production" })).toBe(false);
  });

  it("the census contract accepts a device or manual source, or none, and nothing else", () => {
    expect(censusInput.safeParse(record({ lng: 27.49, lat: -11.66, accuracyM: 8 })).success).toBe(
      true,
    );
    expect(
      censusInput.safeParse(record({ lng: 27.49, lat: -11.66, source: "device", accuracyM: 8 }))
        .success,
    ).toBe(true);
    expect(
      censusInput.safeParse(record({ lng: 27.49, lat: -11.66, source: "manual" })).success,
    ).toBe(true);
    expect(
      censusInput.safeParse(record({ lng: 27.49, lat: -11.66, source: "guess" })).success,
    ).toBe(false);
  });
});
