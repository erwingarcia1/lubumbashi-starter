import { sql } from "drizzle-orm";

import type { Db, Tx } from "@/lib/db/client";

export interface LngLat {
  lng: number;
  lat: number;
}

/** Circle geofence of a zone (placeholder until cadastre polygons exist, D6/D37). */
export interface Fence {
  zoneId: string;
  zoneCode: string;
  zoneName: string;
  level: "quartier" | "commune";
  center: LngLat;
  radiusM: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine); accurate to well under 1 m at a city scale. */
export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * The GPS accuracy is added to the radius so a fix taken at the edge of the zone with a poor
 * signal is not refused; capped so an absurd accuracy cannot unlock the whole city.
 */
// DECISION-PENDING: D37 — tolerance for GPS accuracy.
export const ACCURACY_TOLERANCE_MAX_M = 500;

export interface FenceVerdict {
  inside: boolean;
  /** Metres from the zone centre. */
  distanceM: number;
  /** Radius actually applied (fence radius + tolerated accuracy). */
  allowedM: number;
}

export function checkInside(fence: Fence, gps: LngLat, accuracyM?: number | null): FenceVerdict {
  const tolerance = Math.min(Math.max(accuracyM ?? 0, 0), ACCURACY_TOLERANCE_MAX_M);
  const allowedM = fence.radiusM + tolerance;
  const distanceM = haversineM(fence.center, gps);
  return { inside: distanceM <= allowedM, distanceM: Math.round(distanceM), allowedM };
}

/**
 * An agent's fence: the assigned quartier when it carries a circle, else the commune, else none
 * (no fence = every position is accepted).
 */
// DECISION-PENDING: D37 — where an agent may collect.
export async function fenceFor(db: Db | Tx, agentId: string): Promise<Fence | null> {
  const rows = (
    await db.execute<{
      zone_id: string;
      code: string;
      name: string;
      level: "quartier" | "commune";
      lng: number;
      lat: number;
      radius_m: number;
    }>(sql`
      select z.id as zone_id, z.code, z.name, z.level,
             extensions.ST_X(z.centroid) as lng, extensions.ST_Y(z.centroid) as lat, z.radius_m
      from app.agents a
      join app.zones z on z.id in (a.zone_id, a.commune_id)
      where a.id = ${agentId} and z.centroid is not null and z.radius_m is not null
      order by case when z.id = a.zone_id then 0 else 1 end
      limit 1`)
  ).rows;
  const z = rows[0];
  if (!z) return null;
  return {
    zoneId: z.zone_id,
    zoneCode: z.code,
    zoneName: z.name,
    level: z.level,
    center: { lng: Number(z.lng), lat: Number(z.lat) },
    radiusM: Number(z.radius_m),
  };
}
