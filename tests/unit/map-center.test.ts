import { describe, expect, it } from "vitest";

import { CITY_CENTER, COMMUNE_CENTERS, POINTS_MAX_ZOOM, mapView } from "@/lib/admin/map-center";

describe("mapView", () => {
  it("frames every point when there are several (clusters in two communes stay visible)", () => {
    const v = mapView(
      [
        { lat: -11.66, lng: 27.49 },
        { lat: -11.67, lng: 27.5 },
        { lat: -11.625, lng: 27.545 },
      ],
      undefined,
    );
    expect(v).toEqual({
      kind: "bounds",
      bounds: [
        [-11.67, 27.49],
        [-11.625, 27.545],
      ],
    });
  });

  it("centres on the only point at the quartier zoom", () => {
    expect(mapView([{ lat: -11.6642, lng: 27.493 }], "KAM")).toEqual({
      kind: "center",
      center: [-11.6642, 27.493],
      zoom: POINTS_MAX_ZOOM,
    });
  });

  it("falls back to the selected commune when it has no point yet", () => {
    expect(mapView([], "RUA")).toEqual({
      kind: "center",
      center: [COMMUNE_CENTERS.RUA!.lat, COMMUNE_CENTERS.RUA!.lng],
      zoom: COMMUNE_CENTERS.RUA!.zoom,
    });
  });

  it("shows the whole city for 'toutes les communes' or an unknown code", () => {
    expect(mapView([], undefined)).toEqual({
      kind: "center",
      center: [CITY_CENTER.lat, CITY_CENTER.lng],
      zoom: CITY_CENTER.zoom,
    });
    expect(mapView([], "XXX")).toMatchObject({ zoom: CITY_CENTER.zoom });
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
