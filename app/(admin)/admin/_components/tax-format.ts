import type { RuleListItem } from "@/lib/admin/taxes";
import { formatFC } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";

export function calcText(v: RuleListItem["current"]): string {
  if (!v) return t.common.none;
  if (v.calcKind === "fixed") return `${formatFC(v.amountFc ?? 0)} ${t.admin.taxes.fixed}`;
  return `${((v.rateBp ?? 0) / 100).toLocaleString("fr-FR")} % ${t.admin.taxes.percentOfBase}`;
}

export function penaltyText(v: RuleListItem["current"]): string {
  if (!v || v.penaltyKind === "none") return t.common.none;
  const rate = `${((v.penaltyRateBp ?? 0) / 100).toLocaleString("fr-FR")} %`;
  if (v.penaltyKind === "monthly_percent") return `${rate} ${t.admin.taxes.perMonthPenalty}`;
  if (v.penaltyKind === "once_fixed") {
    return `${formatFC(v.penaltyAmountFc ?? 0)} ${t.admin.taxes.penaltyAfter} ${v.graceDays} ${t.admin.taxes.days}`;
  }
  return `${rate} ${t.admin.taxes.penaltyAfter} ${v.graceDays} ${t.admin.taxes.days}`;
}
