import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  integer,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  app,
  overrideKind,
  penaltyKind,
  ruleCalcKind,
  ruleFrequency,
  ruleVersionStatus,
} from "./enums";
import { admins } from "./identity";

/** Ménage, Commerce, Industrie, Étal de marché, Propriété. Labels are data (invariant 8). */
export const categories = app.table("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  labelFr: text("label_fr").notNull(),
  labelSw: text("label_sw"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * One rule per (tax, category), exactly like the rows of the "Taxes & barèmes" screen:
 * assainissement_menage, assainissement_commerce, etalage, patente… `tax_code` groups the
 * rows of one tax for reporting. Amounts and penalties live in versions (invariant 6).
 */
export const taxRules = app.table("tax_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  taxCode: text("tax_code").notNull(),
  labelFr: text("label_fr").notNull(),
  labelSw: text("label_sw"),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => categories.id),
  // DECISION-PENDING: D26 — which legal entity is the creditor; free text for now.
  issuingAuthority: text("issuing_authority"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const taxRuleVersions = app.table(
  "tax_rule_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taxRuleId: uuid("tax_rule_id")
      .notNull()
      .references(() => taxRules.id),
    version: integer("version").notNull(),
    status: ruleVersionStatus("status").notNull().default("draft"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    calcKind: ruleCalcKind("calc_kind").notNull(),
    /** Fixed amount in FC (calc_kind = fixed). */
    amountFc: integer("amount_fc"),
    /** Rate in basis points of the entity's tax base (calc_kind = percent_of_base). */
    rateBp: integer("rate_bp"),
    frequency: ruleFrequency("frequency").notNull(),
    /** Day of the period the obligation is due; null = last day of the period. */
    dueDay: integer("due_day"),
    penaltyKind: penaltyKind("penalty_kind").notNull().default("none"),
    penaltyRateBp: integer("penalty_rate_bp"),
    penaltyAmountFc: integer("penalty_amount_fc"),
    graceDays: integer("grace_days").notNull().default(30),
    // DECISION-PENDING: D22 — cap placeholder 100 % of principal (10 000 bp).
    penaltyCapBp: integer("penalty_cap_bp"),
    // DECISION-PENDING: D3 — document reference per change, optional.
    referenceDocument: text("reference_document"),
    proposedByAdminId: uuid("proposed_by_admin_id").references(() => admins.id),
    approvedByAdminId: uuid("approved_by_admin_id").references(() => admins.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("tax_rule_versions_rule_version_uniq").on(t.taxRuleId, t.version),
    unique("tax_rule_versions_rule_effective_uniq").on(t.taxRuleId, t.effectiveFrom),
    check(
      "tax_rule_versions_calc_shape",
      sql`(${t.calcKind} = 'fixed' and ${t.amountFc} is not null and ${t.amountFc} >= 0) or (${t.calcKind} = 'percent_of_base' and ${t.rateBp} is not null and ${t.rateBp} >= 0)`,
    ),
    check(
      "tax_rule_versions_penalty_shape",
      sql`(${t.penaltyKind} = 'none') or (${t.penaltyKind} in ('once_percent','monthly_percent') and ${t.penaltyRateBp} >= 0) or (${t.penaltyKind} = 'once_fixed' and ${t.penaltyAmountFc} >= 0)`,
    ),
    check("tax_rule_versions_grace_nonneg", sql`${t.graceDays} >= 0`),
  ],
);

/**
 * Per-entity exception to "category drives the rules": include a rule that the category does
 * not carry, or exclude one it does. Every row is created by an admin with a reason.
 */
export const entityRuleOverrides = app.table(
  "entity_rule_overrides",
  {
    entityId: uuid("entity_id").notNull(),
    taxRuleId: uuid("tax_rule_id")
      .notNull()
      .references(() => taxRules.id),
    kind: overrideKind("kind").notNull(),
    reason: text("reason").notNull(),
    createdByAdminId: uuid("created_by_admin_id").references(() => admins.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.taxRuleId] })],
);
