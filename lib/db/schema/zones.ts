import { sql } from "drizzle-orm";
import { integer, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

import { app, zoneLevel } from "./enums";

/** Lubumbashi → commune → quartier. Commune codes are data, never derived from names. */
export const zones = app.table(
  "zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    level: zoneLevel("level").notNull(),
    // DECISION-PENDING: D24 — commune codes KAM, LUB, KEN, KAT, KAL, RUA, ANN until the Mairie confirms.
    code: text("code").notNull(),
    name: text("name").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => zones.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("zones_commune_code_uniq")
      .on(t.code)
      .where(sql`${t.level} = 'commune'`),
    uniqueIndex("zones_quartier_code_uniq")
      .on(t.parentId, t.code)
      .where(sql`${t.level} = 'quartier'`),
  ],
);

/** Gapless per-commune counter behind `LUB-<code>-<8 digits>`; locked with UPDATE … RETURNING. */
export const idCounters = app.table("id_counters", {
  communeCode: text("commune_code").primaryKey(),
  last: integer("last").notNull().default(0),
});
