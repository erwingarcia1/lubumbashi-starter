import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { app, obligationStatus } from "./enums";
import { admins } from "./identity";
import { taxRules, taxRuleVersions } from "./taxes";
import { entities, taxpayers } from "./taxpayers";

/**
 * One amount due for one entity, one rule version, one period. The version is frozen at issue
 * time (invariant 6). `paid_fc` and `status` are caches of payment_allocations of confirmed
 * payments, maintained in the same transaction that confirms a payment.
 */
export const obligations = app.table(
  "obligations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    taxpayerId: uuid("taxpayer_id")
      .notNull()
      .references(() => taxpayers.id),
    taxRuleId: uuid("tax_rule_id")
      .notNull()
      .references(() => taxRules.id),
    taxRuleVersionId: uuid("tax_rule_version_id")
      .notNull()
      .references(() => taxRuleVersions.id),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    dueDate: date("due_date").notNull(),
    amountFc: integer("amount_fc").notNull(),
    penaltyFc: integer("penalty_fc").notNull().default(0),
    paidFc: integer("paid_fc").notNull().default(0),
    status: obligationStatus("status").notNull().default("due"),
    /**
     * Avis d'imposition number `AV-YYMM-NNNNNN` (YYMM of the period start) and the random token
     * of its QR (`/f/<no>/<token>`); both assigned by the database trigger on insert (0008).
     */
    invoiceNo: text("invoice_no"),
    invoiceToken: text("invoice_token"),
    /** First issue of the note de perception (PDF) from the back office; later prints re-issue. */
    invoiceIssuedAt: timestamp("invoice_issued_at", { withTimezone: true }),
    invoiceIssuedByAdminId: uuid("invoice_issued_by_admin_id").references(() => admins.id),
    waivedReason: text("waived_reason"),
    waivedByAdminId: uuid("waived_by_admin_id").references(() => admins.id),
    cancelledReason: text("cancelled_reason"),
    cancelledByAdminId: uuid("cancelled_by_admin_id").references(() => admins.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("obligations_entity_rule_period_uniq").on(t.entityId, t.taxRuleId, t.periodStart),
    index("obligations_taxpayer_status_idx").on(t.taxpayerId, t.status),
    index("obligations_due_date_idx").on(t.dueDate),
    uniqueIndex("obligations_invoice_no_uniq").on(t.invoiceNo),
    check("obligations_amount_nonneg", sql`${t.amountFc} >= 0`),
    check("obligations_penalty_nonneg", sql`${t.penaltyFc} >= 0`),
    check("obligations_paid_nonneg", sql`${t.paidFc} >= 0`),
    check("obligations_period_order", sql`${t.periodStart} <= ${t.periodEnd}`),
  ],
);

/** Gapless counter behind invoice numbers, one row per YYMM. */
export const invoiceCounters = app.table("invoice_counters", {
  yymm: text("yymm").primaryKey(),
  last: integer("last").notNull().default(0),
});
