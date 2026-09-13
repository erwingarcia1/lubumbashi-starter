import type { EntityInput, Override, Rule, RuleVersion } from "./types";

/** Category rules, plus explicit includes, minus explicit excludes (entity_rule_overrides). */
export function applicableRules(entity: EntityInput, rules: Rule[], overrides: Override[]): Rule[] {
  const included = new Set(overrides.filter((o) => o.kind === "include").map((o) => o.taxRuleId));
  const excluded = new Set(overrides.filter((o) => o.kind === "exclude").map((o) => o.taxRuleId));
  return rules.filter(
    (r) =>
      r.active && !excluded.has(r.id) && (r.categoryId === entity.categoryId || included.has(r.id)),
  );
}

/**
 * The version that governs a period: not a draft, effective on the period's first day, and the
 * latest such one. Obligations keep this id forever (invariant 6).
 */
export function versionFor(rule: Rule, periodStart: string): RuleVersion | null {
  let best: RuleVersion | null = null;
  for (const v of rule.versions) {
    if (v.status === "draft") continue;
    if (v.effectiveFrom > periodStart) continue;
    if (v.effectiveTo !== null && v.effectiveTo <= periodStart) continue;
    if (best === null || v.effectiveFrom > best.effectiveFrom) best = v;
  }
  return best;
}
