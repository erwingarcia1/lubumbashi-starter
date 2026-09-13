/**
 * Where the map looks when a commune has no registered point yet (the pilot only covers Kampemba).
 * Approximate centroids of the seven communes of Lubumbashi; the census points take over as soon as
 * one entity exists. Not a schema concern: a zone centroid column can replace this when D6 lands.
 */
// DECISION-PENDING: D24 — commune codes to confirm with the Mairie.
export const COMMUNE_CENTERS: Record<string, { lat: number; lng: number; zoom: number }> = {
  KAM: { lat: -11.662, lng: 27.505, zoom: 14 },
  LUB: { lat: -11.663, lng: 27.479, zoom: 14 },
  KEN: { lat: -11.685, lng: 27.465, zoom: 14 },
  KAT: { lat: -11.695, lng: 27.455, zoom: 14 },
  KAL: { lat: -11.677, lng: 27.482, zoom: 15 },
  RUA: { lat: -11.625, lng: 27.545, zoom: 14 },
  ANN: { lat: -11.6, lng: 27.5, zoom: 12 },
};

/** Whole-city view for "Toutes les communes" with no point. */
export const CITY_CENTER = { lat: -11.664, lng: 27.49, zoom: 12 };

/** Closest the map goes when it frames the points (about the size of a quartier). */
export const POINTS_MAX_ZOOM = 15;

export type MapView =
  | { kind: "center"; center: [number, number]; zoom: number }
  | { kind: "bounds"; bounds: [[number, number], [number, number]] };

/**
 * Frame every point when there are several (so "Toutes les communes" shows all clusters), centre
 * on the only point, otherwise on the selected commune (or the whole city).
 */
export function mapView(
  points: Array<{ lat: number; lng: number }>,
  communeCode?: string | null,
): MapView {
  if (points.length > 1) {
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    return {
      kind: "bounds",
      bounds: [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ],
    };
  }
  if (points.length === 1) {
    return { kind: "center", center: [points[0]!.lat, points[0]!.lng], zoom: POINTS_MAX_ZOOM };
  }
  const c = (communeCode && COMMUNE_CENTERS[communeCode]) || CITY_CENTER;
  return { kind: "center", center: [c.lat, c.lng], zoom: c.zoom };
}
