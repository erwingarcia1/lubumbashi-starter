import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  geometry,
  index,
  inet,
  jsonb,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { actorType, app } from "./enums";
import { devices } from "./identity";

/**
 * Append-only (invariant 4): the runtime role has no UPDATE/DELETE/TRUNCATE grant and a trigger
 * rejects them for every role. WHO = actor_*, WHAT = action + object_*, WHEN = created_at
 * (server clock), WHERE = gps or ip, DEVICE = device_id or user_agent.
 */
export const auditLog = app.table(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    actorType: actorType("actor_type").notNull(),
    actorId: uuid("actor_id"),
    actorRole: text("actor_role"),
    /** Human label frozen at write time (matricule, email, "système"). */
    actorLabel: text("actor_label"),
    action: text("action").notNull(),
    objectType: text("object_type").notNull(),
    objectId: text("object_id").notNull(),
    details: jsonb("details").notNull().default({}),
    /** Free-text justification for sensitive actions (category change, waiver, cancellation). */
    reason: text("reason"),
    requestId: text("request_id"),
    gps: geometry("gps", { type: "point", mode: "xy", srid: 4326 }),
    ip: inet("ip"),
    deviceId: uuid("device_id").references(() => devices.id),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    businessDate: date("business_date").generatedAlwaysAs(
      (): ReturnType<typeof sql> => sql`util.business_date(created_at)`,
    ),
  },
  (t) => [
    index("audit_log_created_idx").on(t.createdAt),
    index("audit_log_object_idx").on(t.objectType, t.objectId),
    index("audit_log_actor_idx").on(t.actorId),
  ],
);
