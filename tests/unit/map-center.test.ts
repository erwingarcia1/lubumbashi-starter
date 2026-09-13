import { describe, expect, it } from "vitest";

import { CITY_CENTER, COMMUNE_CENTERS, mapView } from "@/lib/admin/map-center";

describe("mapView", () => {
  it("centres on the points when there are any", () => {
    const v = mapView(
      [
        { lat: -11.66, lng: 27.49 },
        { lat: -11.67, lng: 27.5 },
      ],
      "KAM",
    );
    expect(v.center[0]).toBeCloseTo(-11.665, 6);
    expect(v.center[1]).toBeCloseTo(27.495, 6);
    expect(v.zoom).toBe(15);
  });

  it("falls back to the selected commune when it has no point yet", () => {
    const v = mapView([], "RUA");
    expect(v.center).toEqual([COMMUNE_CENTERS.RUA!.lat, COMMUNE_CENTERS.RUA!.lng]);
    expect(v.zoom).toBe(COMMUNE_CENTERS.RUA!.zoom);
  });

  it("shows the whole city for 'toutes les communes' or an unknown code", () => {
    expect(mapView([], undefined).center).toEqual([CITY_CENTER.lat, CITY_CENTER.lng]);
    expect(mapView([], "XXX").zoom).toBe(CITY_CENTER.zoom);
  });

  it("knows the seven communes of Lubumbashi", () => {
    expect(Object.keys(COMMUNE_CENTERS).sort()).toEqual([
      "ANN",
      "KAL",
      "KAM",
      "KAT",
      "KEN",
      "LUB",
      "RUA",
    ]);
    for (const c of Object.values(COMMUNE_CENTERS)) {
      expect(c.lat).toBeLessThan(-11.5);
      expect(c.lat).toBeGreaterThan(-11.8);
      expect(c.lng).toBeGreaterThan(27.3);
      expect(c.lng).toBeLessThan(27.7);
    }
  });
});
