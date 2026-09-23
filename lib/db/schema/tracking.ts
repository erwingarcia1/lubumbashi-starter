import { sql } from "drizzle-orm";
import { bigint, date, geometry, index, integer, timestamp, uuid } from "drizzle-orm/pg-core";

import { app, positionSource } from "./enums";
import { agents, devices } from "./identity";

/**
 * Where an agent's device was, while the app was open and the agent logged in. Positions are
 * pings sent by the app every few minutes, plus the GPS of a census or a payment. Kept 90 days
 * then purged by a job. DECISION-PENDING: D38 — tracking hours, retention, who may see it.
 */
export const agentPositions = app.table(
  "agent_positions",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    deviceId: uuid("device_id").references(() => devices.id),
    /** Device clock when the fix was taken; `received_at` is the server clock. */
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    location: geometry("location", { type: "point", mode: "xy", srid: 4326 }).notNull(),
    accuracyM: integer("accuracy_m"),
    source: positionSource("source").notNull().default("ping"),
    businessDate: date("business_date").generatedAlwaysAs(
      (): ReturnType<typeof sql> => sql`util.business_date(recorded_at)`,
    ),
  },
  (t) => [
    index("agent_positions_agent_time_idx").on(t.agentId, t.recordedAt),
    index("agent_positions_business_date_idx").on(t.businessDate),
  ],
);
