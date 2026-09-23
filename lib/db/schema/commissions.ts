import { sql } from "drizzle-orm";
import { check, date, index, integer, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { app, commissionBasis, commissionLineKind, commissionStatementStatus } from "./enums";
import { admins, agents } from "./identity";
import { payments } from "./payments";
import { taxRules } from "./taxes";
import { taxpayers } from "./taxpayers";

/**
 * Commission rules are data, versioned by effective date like tax rules (invariant 6): the rule
 * applied to a collection is the latest one effective on its business date. `rate_bp` is a
 * percentage in basis points of the amount collected; `amount_fc` a fixed amount per act.
 * `tax_rule_id` null = every tax. DECISION-PENDING: D36 — the Mairie's actual scheme.
 */
export const commissionRules = app.table(
  "commission_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    labelFr: text("label_fr").notNull(),
    basis: commissionBasis("basis").notNull(),
    rateBp: integer("rate_bp").notNull().default(0),
    amountFc: integer("amount_fc").notNull().default(0),
    taxRuleId: uuid("tax_rule_id").references(() => taxRules.id),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    createdByAdminId: uuid("created_by_admin_id").references(() => admins.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("commission_rules_code_from_uniq").on(t.code, t.effectiveFrom),
    check("commission_rules_rate_range", sql`${t.rateBp} >= 0 and ${t.rateBp} <= 10000`),
    check("commission_rules_amount_nonneg", sql`${t.amountFc} >= 0`),
  ],
);

/**
 * One statement per agent per month (`period` = YYYY-MM). Draft statements are recomputed from
 * payments until Finances approves them; approved and paid statements are frozen with their
 * lines. Amounts are integer FC (invariant 9); reversals make negative lines.
 */
export const commissionStatements = app.table(
  "commission_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    period: text("period").notNull(),
    status: commissionStatementStatus("status").notNull().default("draft"),
    collectionsCount: integer("collections_count").notNull().default(0),
    collectedFc: integer("collected_fc").notNull().default(0),
    collectionCommissionFc: integer("collection_commission_fc").notNull().default(0),
    registrationsCount: integer("registrations_count").notNull().default(0),
    registrationCommissionFc: integer("registration_commission_fc").notNull().default(0),
    totalFc: integer("total_fc").notNull().default(0),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByAdminId: uuid("approved_by_admin_id").references(() => admins.id),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidByAdminId: uuid("paid_by_admin_id").references(() => admins.id),
    /** Reference of the payout (bank or mobile-money transfer), free text. */
    paidReference: text("paid_reference"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("commission_statements_agent_period_uniq").on(t.agentId, t.period),
    index("commission_statements_period_idx").on(t.period),
    check("commission_statements_period_format", sql`${t.period} ~ '^[0-9]{4}-[0-9]{2}$'`),
  ],
);

export const commissionLines = app.table(
  "commission_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    statementId: uuid("statement_id")
      .notNull()
      .references(() => commissionStatements.id, { onDelete: "cascade" }),
    kind: commissionLineKind("kind").notNull(),
    ruleId: uuid("rule_id").references(() => commissionRules.id),
    paymentId: uuid("payment_id").references(() => payments.id),
    taxpayerId: uuid("taxpayer_id").references(() => taxpayers.id),
    businessDate: date("business_date").notNull(),
    /** Amount the commission was computed on (collected FC) or 0 for fixed amounts. */
    baseFc: integer("base_fc").notNull().default(0),
    rateBp: integer("rate_bp").notNull().default(0),
    /** Signed: reversals are negative. */
    amountFc: integer("amount_fc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("commission_lines_statement_idx").on(t.statementId),
    index("commission_lines_payment_idx").on(t.paymentId),
  ],
);
