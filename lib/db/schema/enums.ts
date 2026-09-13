import { pgSchema } from "drizzle-orm/pg-core";

/**
 * All application tables live in schema `app`, never in `public`: Supabase's REST API only
 * exposes `public`, and its automatic grants to anon/authenticated apply to `public` only.
 */
export const app = pgSchema("app");

export const taxpayerKind = app.enum("taxpayer_kind", ["person", "company"]);
export const taxpayerStatus = app.enum("taxpayer_status", ["active", "merged", "archived"]);
export const entityStatus = app.enum("entity_status", ["active", "closed"]);
export const entityKind = app.enum("entity_kind", ["property", "business", "activity"]);
export const zoneLevel = app.enum("zone_level", ["commune", "quartier"]);

export const ruleCalcKind = app.enum("rule_calc_kind", ["fixed", "percent_of_base"]);
export const ruleFrequency = app.enum("rule_frequency", ["monthly", "quarterly", "annual"]);
export const penaltyKind = app.enum("penalty_kind", [
  "none",
  "once_percent",
  "once_fixed",
  "monthly_percent",
]);
export const ruleVersionStatus = app.enum("rule_version_status", [
  "draft",
  "approved",
  "superseded",
]);
export const overrideKind = app.enum("override_kind", ["include", "exclude"]);

export const obligationStatus = app.enum("obligation_status", [
  "due",
  "partially_paid",
  "paid",
  "waived",
  "cancelled",
]);

export const paymentStatus = app.enum("payment_status", [
  "initiated",
  "pending",
  "confirmed",
  "failed",
  "reversed",
  "expired",
]);
// DECISION-PENDING: D10 — no cash channel exists; D11/D14 — real providers arrive later.
export const paymentChannel = app.enum("payment_channel", [
  "mock",
  "mpesa",
  "airtel",
  "orange",
  "tpe",
]);
export const paymentOrigin = app.enum("payment_origin", ["agent", "portal", "counter"]);
export const allocationKind = app.enum("allocation_kind", ["principal", "penalty"]);
export const receiptStatus = app.enum("receipt_status", ["issued", "cancelled"]);

export const agentStatus = app.enum("agent_status", ["active", "suspended"]);
export const deviceStatus = app.enum("device_status", ["active", "revoked"]);
export const adminRole = app.enum("admin_role", [
  "administrateur",
  "maire",
  "finances",
  "superviseur",
  "auditeur",
]);
export const actorType = app.enum("actor_type", ["admin", "agent", "system", "taxpayer"]);

export const photoKind = app.enum("photo_kind", ["facade", "other"]);

export const reconciliationRunStatus = app.enum("reconciliation_run_status", [
  "running",
  "completed",
  "failed",
]);
export const exceptionType = app.enum("exception_type", [
  "missing_at_provider",
  "missing_on_platform",
  "amount_mismatch",
  "duplicate_at_provider",
  "status_mismatch",
]);
export const exceptionStatus = app.enum("exception_status", ["open", "resolved"]);
export const statementMatchStatus = app.enum("statement_match_status", ["matched", "unmatched"]);

export const notificationKind = app.enum("notification_kind", [
  "registration",
  "payment_confirmed",
  "reminder",
  "receipt",
]);
export const notificationChannel = app.enum("notification_channel", ["sms", "whatsapp", "email"]);
export const notificationStatus = app.enum("notification_status", ["queued", "sent", "failed"]);

export const complaintStatus = app.enum("complaint_status", [
  "open",
  "in_progress",
  "resolved",
  "rejected",
]);
