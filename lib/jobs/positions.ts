import { sql } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import { businessDate } from "@/lib/time";

/** Agent positions are kept this many business days, then purged nightly. */
// DECISION-PENDING: D38 — retention.
export const POSITION_RETENTION_DAYS = 90;

/** Deletes positions whose business day is older than `olderThanDays` before `now`. */
export async function purgePositions(
  db: Db,
  olderThanDays = POSITION_RETENTION_DAYS,
  now = new Date(),
): Promise<{ deleted: number; before: string }> {
  const before = businessDate(new Date(now.getTime() - olderThanDays * 86_400_000));
  const res = await db.execute(
    sql`delete from app.agent_positions where business_date < ${before}::date`,
  );
  return { deleted: res.rowCount ?? 0, before };
}
