import { businessClock } from "@/lib/time";

import { dueDateFor, periodsBetween, type YearMonth } from "./periods";
import { applyBp } from "./round";
import { applicableRules, versionFor } from "./rules";
import type {
  EntityInput,
  Exemption,
  ObligationDraft,
  Override,
  Rule,
  RuleVersion,
  SkippedPeriod,
} from "./types";

export interface ComputeInput {
  entity: EntityInput;
  rules: Rule[];
  overrides?: Override[];
  exemptions?: Exemption[];
  /** Obligations are produced up to and including the period containing this instant. */
  asOf: Date;
}

export interface ComputeResult {
  obligations: ObligationDraft[];
  skipped: SkippedPeriod[];
}

/** Amount of one period under one version; null when a percent rule has no base to apply to. */
export function amountFor(version: RuleVersion, entity: EntityInput): number | null {
  if (version.calcKind === "fixed") return version.amountFc ?? 0;
  if (entity.taxBaseFc === null) return null;
  return applyBp(entity.taxBaseFc, version.rateBp ?? 0);
}

export function isExempt(exemptions: Exemption[], taxRuleId: string, periodStart: string): boolean {
  return exemptions.some(
    (e) =>
      (e.taxRuleId === null || e.taxRuleId === taxRuleId) &&
      e.validFrom <= periodStart &&
      (e.validTo === null || e.validTo >= periodStart),
  );
}

/**
 * Every obligation an entity owes from its registration period to `asOf`, each frozen to the
 * rule version in force on the period's first day.
 */
// DECISION-PENDING: D27 — liability starts with the period of registration, never earlier.
export function computeObligations(input: ComputeInput): ComputeResult {
  const { entity, rules } = input;
  const overrides = input.overrides ?? [];
  const exemptions = input.exemptions ?? [];
  const obligations: ObligationDraft[] = [];
  const skipped: SkippedPeriod[] = [];
  if (!entity.active) return { obligations, skipped };

  const reg = businessClock(entity.registeredAt);
  const from: YearMonth = { year: reg.year, month: reg.month };
  const now = businessClock(input.asOf);
  const to: YearMonth = { year: now.year, month: now.month };

  for (const rule of applicableRules(entity, rules, overrides)) {
    const frequency = rule.versions[0]?.frequency ?? "monthly";
    for (const period of periodsBetween(frequency, from, to)) {
      const version = versionFor(rule, period.start);
      if (version === null) {
        skipped.push({ taxRuleId: rule.id, periodStart: period.start, reason: "no_version" });
        continue;
      }
      if (isExempt(exemptions, rule.id, period.start)) {
        skipped.push({ taxRuleId: rule.id, periodStart: period.start, reason: "exempt" });
        continue;
      }
      const amountFc = amountFor(version, entity);
      if (amountFc === null) {
        skipped.push({ taxRuleId: rule.id, periodStart: period.start, reason: "no_tax_base" });
        continue;
      }
      obligations.push({
        entityId: entity.id,
        taxRuleId: rule.id,
        taxRuleVersionId: version.id,
        periodStart: period.start,
        periodEnd: period.end,
        dueDate: dueDateFor(period, version.dueDay),
        amountFc,
      });
    }
  }
  return { obligations, skipped };
}
