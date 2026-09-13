import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  app,
  exceptionStatus,
  exceptionType,
  paymentChannel,
  reconciliationRunStatus,
  statementMatchStatus,
} from "./enums";
import { admins } from "./identity";
import { payments } from "./payments";

/** One nightly run per provider per business day. */
export const reconciliationRuns = app.table(
  "reconciliation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessDate: date("business_date").notNull(),
    provider: paymentChannel("provider").notNull(),
    status: reconciliationRunStatus("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    platformCount: integer("platform_count").notNull().default(0),
    platformTotalFc: integer("platform_total_fc").notNull().default(0),
    statementCount: integer("statement_count").notNull().default(0),
    statementTotalFc: integer("statement_total_fc").notNull().default(0),
    matchedCount: integer("matched_count").notNull().default(0),
    exceptionCount: integer("exception_count").notNull().default(0),
    error: text("error"),
  },
  (t) => [unique("reconciliation_runs_day_provider_uniq").on(t.businessDate, t.provider)],
);

/** Every line of the provider's statement, as received, with its match result. */
export const providerStatementLines = app.table(
  "provider_statement_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => reconciliationRuns.id),
    provider: paymentChannel("provider").notNull(),
    providerReference: text("provider_reference").notNull(),
    platformReference: text("platform_reference"),
    amountFc: integer("amount_fc").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    payerPhone: text("payer_phone"),
    raw: jsonb("raw").notNull(),
    matchStatus: statementMatchStatus("match_status").notNull().default("unmatched"),
    matchedPaymentId: uuid("matched_payment_id").references(() => payments.id),
  },
  (t) => [
    unique("provider_statement_lines_uniq").on(t.runId, t.provider, t.providerReference),
    index("provider_statement_lines_platform_ref_idx").on(t.platformReference),
    check("provider_statement_lines_amount_nonneg", sql`${t.amountFc} >= 0`),
  ],
);

export const reconciliationExceptions = app.table(
  "reconciliation_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => reconciliationRuns.id),
    type: exceptionType("type").notNull(),
    status: exceptionStatus("status").notNull().default("open"),
    paymentId: uuid("payment_id").references(() => payments.id),
    statementLineId: uuid("statement_line_id").references(() => providerStatementLines.id),
    platformAmountFc: integer("platform_amount_fc"),
    statementAmountFc: integer("statement_amount_fc"),
    note: text("note"),
    resolution: text("resolution"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByAdminId: uuid("resolved_by_admin_id").references(() => admins.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("reconciliation_exceptions_run_status_idx").on(t.runId, t.status)],
);

/** A business day is closed by Finances only when it has zero open exceptions. */
export const dailyCloses = app.table("daily_closes", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessDate: date("business_date").notNull().unique(),
  closedAt: timestamp("closed_at", { withTimezone: true }).defaultNow().notNull(),
  closedByAdminId: uuid("closed_by_admin_id").references(() => admins.id),
  transactionCount: integer("transaction_count").notNull().default(0),
  totalFc: integer("total_fc").notNull().default(0),
  note: text("note"),
});
