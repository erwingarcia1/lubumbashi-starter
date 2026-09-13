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
  allocationKind,
  app,
  paymentChannel,
  paymentOrigin,
  paymentStatus,
  receiptStatus,
} from "./enums";
import { admins, agents, devices } from "./identity";
import { obligations } from "./obligations";
import { entities, taxpayers } from "./taxpayers";

/**
 * One payment attempt. `reference` (TX-YYMM-DD-HHMM-XXXX) is generated server-side before any
 * provider is contacted (invariant 5). `status = confirmed` is only reachable together with a
 * provider_confirmations row: a deferred constraint trigger enforces it (invariant 1).
 */
export const payments = app.table(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull().unique(),
    taxpayerId: uuid("taxpayer_id")
      .notNull()
      .references(() => taxpayers.id),
    entityId: uuid("entity_id").references(() => entities.id),
    amountFc: integer("amount_fc").notNull(),
    channel: paymentChannel("channel").notNull(),
    origin: paymentOrigin("origin").notNull(),
    payerPhone: text("payer_phone").notNull(),
    status: paymentStatus("status").notNull().default("initiated"),
    /** The provider's own id for the request we sent, if it returns one. */
    providerRequestId: text("provider_request_id"),
    /** Obligations the payer chose (null = all open ones); allocation serves them first. */
    targetObligationIds: uuid("target_obligation_ids").array(),
    initiatedByAgentId: uuid("initiated_by_agent_id").references(() => agents.id),
    initiatedDeviceId: uuid("initiated_device_id").references(() => devices.id),
    // DECISION-PENDING: D28 — expiry after PAYMENT_EXPIRY_HOURS (24).
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    pendingAt: timestamp("pending_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /** Business day in Africa/Lubumbashi (stored, generated). */
    businessDate: date("business_date").generatedAlwaysAs(
      (): ReturnType<typeof sql> => sql`util.business_date(created_at)`,
    ),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("payments_taxpayer_idx").on(t.taxpayerId),
    index("payments_status_idx").on(t.status),
    index("payments_business_date_idx").on(t.businessDate),
    index("payments_channel_status_idx").on(t.channel, t.status),
    check("payments_amount_positive", sql`${t.amountFc} > 0`),
  ],
);

/**
 * The provider's own word (invariant 1): reference, amount, raw payload. One per payment;
 * (provider, provider_reference) unique so a replayed callback cannot create a second row.
 */
export const providerConfirmations = app.table(
  "provider_confirmations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .unique()
      .references(() => payments.id),
    provider: paymentChannel("provider").notNull(),
    providerReference: text("provider_reference").notNull(),
    amountFc: integer("amount_fc").notNull(),
    payerPhone: text("payer_phone"),
    rawPayload: jsonb("raw_payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    businessDate: date("business_date").generatedAlwaysAs(
      (): ReturnType<typeof sql> => sql`util.business_date(created_at)`,
    ),
  },
  (t) => [
    unique("provider_confirmations_provider_ref_uniq").on(t.provider, t.providerReference),
    index("provider_confirmations_business_date_idx").on(t.businessDate),
    check("provider_confirmations_amount_nonneg", sql`${t.amountFc} >= 0`),
  ],
);

/** How a payment is split over obligations (principal and penalty parts). */
export const paymentAllocations = app.table(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    obligationId: uuid("obligation_id")
      .notNull()
      .references(() => obligations.id),
    kind: allocationKind("kind").notNull().default("principal"),
    amountFc: integer("amount_fc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("payment_allocations_uniq").on(t.paymentId, t.obligationId, t.kind),
    index("payment_allocations_obligation_idx").on(t.obligationId),
    check("payment_allocations_amount_positive", sql`${t.amountFc} > 0`),
  ],
);

/**
 * Issued by the server from a confirmed payment only (a constraint trigger checks it), numbered
 * gaplessly (invariant 7), never re-issued: cancelling keeps the row with a reason. `snapshot`
 * holds everything printed so the document never changes after the fact.
 */
export const receipts = app.table(
  "receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptNo: text("receipt_no").notNull().unique(),
    paymentId: uuid("payment_id")
      .notNull()
      .unique()
      .references(() => payments.id),
    taxpayerId: uuid("taxpayer_id")
      .notNull()
      .references(() => taxpayers.id),
    amountFc: integer("amount_fc").notNull(),
    /** Random token for the public verification URL, so numbers cannot be enumerated. */
    verifyToken: text("verify_token").notNull().unique(),
    snapshot: jsonb("snapshot").notNull(),
    status: receiptStatus("status").notNull().default("issued"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    businessDate: date("business_date").generatedAlwaysAs(
      (): ReturnType<typeof sql> => sql`util.business_date(created_at)`,
    ),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledReason: text("cancelled_reason"),
    cancelledByAdminId: uuid("cancelled_by_admin_id").references(() => admins.id),
  },
  (t) => [
    index("receipts_taxpayer_idx").on(t.taxpayerId),
    index("receipts_business_date_idx").on(t.businessDate),
    check("receipts_amount_nonneg", sql`${t.amountFc} >= 0`),
    check(
      "receipts_cancel_shape",
      sql`(${t.status} = 'issued' and ${t.cancelledAt} is null) or (${t.status} = 'cancelled' and ${t.cancelledAt} is not null and ${t.cancelledReason} is not null)`,
    ),
  ],
);

// DECISION-PENDING: D21 — one gapless counter per year; the month in the prefix is informational.
export const receiptCounters = app.table("receipt_counters", {
  year: integer("year").primaryKey(),
  last: integer("last").notNull().default(0),
});
