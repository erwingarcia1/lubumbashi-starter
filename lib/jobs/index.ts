import type { Db } from "@/lib/db/client";
import { processNotificationQueue } from "@/lib/notify";
import { availableChannels } from "@/lib/payments/registry";
import { reconcileDay, type RunSummary } from "@/lib/reconciliation/run";
import { businessDate } from "@/lib/time";

import {
  refreshCurrentMonthDrafts,
  refreshDraftStatements,
  refreshPreviousMonthDrafts,
} from "./commissions";
import { accruePenalties } from "./penalties";
import { purgePositions } from "./positions";

/** Business day before `now` (Africa/Lubumbashi): what the nightly job reconciles. */
export function previousBusinessDate(now = new Date()): string {
  return businessDate(new Date(now.getTime() - 86_400_000));
}

/** The three scheduled jobs (CLAUDE.md: reconciliation, penalty accrual, notification sends). */
export const JOBS = {
  reconcileDaily: "reconcile-daily",
  penaltiesDaily: "penalties-daily",
  notifyFlush: "notify-flush",
  /** Nightly retention of agent positions (D38). */
  positionsPurge: "positions-purge",
  /** Agent commission drafts (D36): the previous month on the 1st, the current month daily. */
  commissionsMonthly: "commissions-monthly",
} as const;

export async function nightlyReconciliation(
  db: Db,
  day = previousBusinessDate(),
): Promise<RunSummary[]> {
  return reconcileDay(db, day, availableChannels());
}

export {
  accruePenalties,
  processNotificationQueue,
  purgePositions,
  refreshCurrentMonthDrafts,
  refreshDraftStatements,
  refreshPreviousMonthDrafts,
};
