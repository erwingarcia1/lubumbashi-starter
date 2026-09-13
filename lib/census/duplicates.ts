import { sql } from "drizzle-orm";

import type { Db } from "@/lib/db/client";

import type { DuplicateQuery } from "./schema";

export interface DuplicateMatch {
  taxpayerNo: string;
  fullName: string;
  phone: string;
  address: string;
  reason: "same_phone" | "similar_name_nearby";
  distanceM: number | null;
}

export const DUPLICATE_RADIUS_M = 30;
export const NAME_SIMILARITY = 0.45;

/**
 * Same phone number, or a similar name (pg_trgm) within 30 m (PostGIS): the two signals the
 * prototype's "Doublon possible" alert relies on. Read-only.
 */
export async function findDuplicates(db: Db, q: DuplicateQuery): Promise<DuplicateMatch[]> {
  const out: DuplicateMatch[] = [];
  if (q.phone) {
    const rows = await db.execute<{
      taxpayer_no: string;
      full_name: string;
      phone: string;
      address: string;
    }>(sql`
      select taxpayer_no, full_name, phone, address from app.taxpayers
      where phone = ${q.phone} and status = 'active' limit 5`);
    for (const r of rows.rows)
      out.push({
        taxpayerNo: r.taxpayer_no,
        fullName: r.full_name,
        phone: r.phone,
        address: r.address,
        reason: "same_phone",
        distanceM: null,
      });
  }
  if (q.fullName && q.gps) {
    const rows = await db.execute<{
      taxpayer_no: string;
      full_name: string;
      phone: string;
      address: string;
      distance_m: number;
    }>(sql`
      select t.taxpayer_no, t.full_name, t.phone, t.address,
             round(extensions.ST_Distance(extensions.ST_SetSRID(e.location, 4326)::extensions.geography,
                   extensions.ST_SetSRID(extensions.ST_MakePoint(${q.gps.lng}, ${q.gps.lat}), 4326)::extensions.geography)::numeric, 1)::float as distance_m
      from app.entities e join app.taxpayers t on t.id = e.taxpayer_id
      where t.status = 'active'
        and extensions.similarity(t.full_name, ${q.fullName}) > ${NAME_SIMILARITY}
        and extensions.ST_DWithin(extensions.ST_SetSRID(e.location, 4326)::extensions.geography,
              extensions.ST_SetSRID(extensions.ST_MakePoint(${q.gps.lng}, ${q.gps.lat}), 4326)::extensions.geography, ${DUPLICATE_RADIUS_M})
      order by distance_m limit 5`);
    for (const r of rows.rows) {
      if (out.some((o) => o.taxpayerNo === r.taxpayer_no)) continue;
      out.push({
        taxpayerNo: r.taxpayer_no,
        fullName: r.full_name,
        phone: r.phone,
        address: r.address,
        reason: "similar_name_nearby",
        distanceM: Number(r.distance_m),
      });
    }
  }
  return out;
}
