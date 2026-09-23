import { eq } from "drizzle-orm";

import { periodOf, previousPeriod } from "@/lib/commissions/period";
import { upsertDraft } from "@/lib/commissions/statements";
import type { Db } from "@/lib/db/client";
import { agents } from "@/lib/db/schema";

export interface RefreshSummary {
  period: string;
  /** Drafts written or refreshed. */
  refreshed: number;
  /** Statements left alone because they are approved or paid. */
  frozen: number;
}

/** Writes or refreshes the draft statement of every active agent for a month (D36). */
export async function refreshDraftStatements(
  db: Db,
  period: string,
  now = new Date(),
): Promise<RefreshSummary> {
  const active = await db.select({ id: agents.id }).from(agents).where(eq(agents.status, "active"));
  let refreshed = 0;
  let frozen = 0;
  for (const a of active) {
    const s = await upsertDraft(db, a.id, period, now);
    if (s.status === "draft") refreshed += 1;
    else frozen += 1;
  }
  return { period, refreshed, frozen };
}

/** Daily at 00:20: the month in progress. */
export function refreshCurrentMonthDrafts(db: Db, now = new Date()): Promise<RefreshSummary> {
  return refreshDraftStatements(db, periodOf(now), now);
}

/** On the 1st at 00:30: the month that just ended, ready for Finances. */
export function refreshPreviousMonthDrafts(db: Db, now = new Date()): Promise<RefreshSummary> {
  return refreshDraftStatements(db, previousPeriod(periodOf(now)), now);
}
