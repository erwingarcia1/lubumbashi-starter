import { index, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";

import {
  app,
  complaintStatus,
  notificationChannel,
  notificationKind,
  notificationStatus,
} from "./enums";
import { admins } from "./identity";
import { payments, receipts } from "./payments";
import { taxpayers } from "./taxpayers";

/** Outbox for SMS/WhatsApp/email; templates live in lib/i18n (invariant 8). */
export const notifications = app.table(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taxpayerId: uuid("taxpayer_id").references(() => taxpayers.id),
    kind: notificationKind("kind").notNull(),
    channel: notificationChannel("channel").notNull().default("sms"),
    to: text("to").notNull(),
    templateKey: text("template_key").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: notificationStatus("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("notifications_status_idx").on(t.status, t.scheduledAt),
    index("notifications_taxpayer_idx").on(t.taxpayerId),
  ],
);

/** Complaint categories are data: "Les déchets ne sont pas collectés" is one row. */
export const complaintCategories = app.table("complaint_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  labelFr: text("label_fr").notNull(),
  labelSw: text("label_sw"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const complaints = app.table(
  "complaints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taxpayerId: uuid("taxpayer_id").references(() => taxpayers.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => complaintCategories.id),
    description: text("description").notNull(),
    contactPhone: text("contact_phone").notNull(),
    paymentId: uuid("payment_id").references(() => payments.id),
    receiptId: uuid("receipt_id").references(() => receipts.id),
    status: complaintStatus("status").notNull().default("open"),
    resolution: text("resolution"),
    handledByAdminId: uuid("handled_by_admin_id").references(() => admins.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("complaints_status_idx").on(t.status, t.createdAt)],
);
