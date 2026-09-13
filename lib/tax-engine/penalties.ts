import { daysLate } from "@/lib/time";

import { applyBp } from "./round";
import type { RuleVersion } from "./types";

/**
 * Late penalty owed on an obligation as of a business day. Nothing within the grace period;
 * `monthly_percent` counts started 30-day blocks after the grace period, simple, not compounding;
 * `penalty_cap_bp` caps the total at that share of the principal.
 */
export function computePenalty(
  version: Pick<
    RuleVersion,
    "penaltyKind" | "penaltyRateBp" | "penaltyAmountFc" | "graceDays" | "penaltyCapBp"
  >,
  obligation: { dueDate: string; amountFc: number },
  asOf: string,
): number {
  const late = daysLate(obligation.dueDate, asOf);
  if (version.penaltyKind === "none" || late <= version.graceDays) return 0;
  let penalty: number;
  switch (version.penaltyKind) {
    case "once_percent":
      penalty = applyBp(obligation.amountFc, version.penaltyRateBp ?? 0);
      break;
    case "once_fixed":
      penalty = version.penaltyAmountFc ?? 0;
      break;
    case "monthly_percent": {
      const blocks = Math.ceil((late - version.graceDays) / 30);
      penalty = applyBp(obligation.amountFc, (version.penaltyRateBp ?? 0) * blocks);
      break;
    }
  }
  if (version.penaltyCapBp !== null) {
    penalty = Math.min(penalty, applyBp(obligation.amountFc, version.penaltyCapBp));
  }
  return penalty;
}
