import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  geometry,
  index,
  integer,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { app, entityKind, entityStatus, photoKind, taxpayerKind, taxpayerStatus } from "./enums";
import { admins, agents, devices } from "./identity";
import { categories, taxRules } from "./taxes";
import { zones } from "./zones";

export const taxpayers = app.table(
  "taxpayers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Municipal ID, e.g. LUB-KAM-00000125; allocated from id_counters, never reused. */
    taxpayerNo: text("taxpayer_no").notNull().unique(),
    kind: taxpayerKind("kind").notNull(),
    fullName: text("full_name").notNull(),
    contactName: text("contact_name"),
    // DECISION-PENDING: D8 — phone is mandatory (E.164, e.g. +243994128830).
    phone: text("phone").notNull(),
    phoneVerified: boolean("phone_verified").notNull().default(false),
    // DECISION-PENDING: D7 — free-text identity document until the standard one is known.
    idType: text("id_type"),
    idNumber: text("id_number"),
    communeId: uuid("commune_id")
      .notNull()
      .references(() => zones.id),
    quartierId: uuid("quartier_id").references(() => zones.id),
    address: text("address").notNull(),
    // DECISION-PENDING: D4 — free-text reason; no automatic exemption logic.
    exemptReason: text("exempt_reason"),
    status: taxpayerStatus("status").notNull().default("active"),
    notes: text("notes"),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull(),
    registeredByAgentId: uuid("registered_by_agent_id").references(() => agents.id),
    registeredDeviceId: uuid("registered_device_id").references(() => devices.id),
    /** Client-generated UUID for idempotent offline census (M8). */
    clientUuid: uuid("client_uuid").unique(),
    mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => taxpayers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("taxpayers_phone_idx").on(t.phone),
    index("taxpayers_commune_idx").on(t.communeId),
    index("taxpayers_full_name_trgm_idx").using("gin", t.fullName.op("gin_trgm_ops")),
  ],
);

export const entities = app.table(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taxpayerId: uuid("taxpayer_id")
      .notNull()
      .references(() => taxpayers.id),
    kind: entityKind("kind").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    name: text("name").notNull(),
    address: text("address").notNull(),
    communeId: uuid("commune_id")
      .notNull()
      .references(() => zones.id),
    quartierId: uuid("quartier_id").references(() => zones.id),
    /**
     * WGS84 point; x = longitude, y = latitude. Drizzle writes plain WKT (SRID 0) and its DDL
     * omits the SRID, so distance queries wrap the column in ST_SetSRID(location, 4326).
     */
    location: geometry("location", { type: "point", mode: "xy", srid: 4326 }).notNull(),
    gpsAccuracyM: integer("gps_accuracy_m"),
    /** Base for percent_of_base rules (e.g. valeur locative), integer FC. */
    taxBaseFc: integer("tax_base_fc"),
    active: boolean("active").notNull().default(true),
    status: entityStatus("status").notNull().default("active"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedReason: text("closed_reason"),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull(),
    registeredByAgentId: uuid("registered_by_agent_id").references(() => agents.id),
    clientUuid: uuid("client_uuid").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("entities_taxpayer_idx").on(t.taxpayerId),
    index("entities_category_idx").on(t.categoryId),
    index("entities_location_gist").using("gist", t.location),
    check("entities_tax_base_fc_nonneg", sql`${t.taxBaseFc} is null or ${t.taxBaseFc} >= 0`),
    check("entities_gps_accuracy_nonneg", sql`${t.gpsAccuracyM} is null or ${t.gpsAccuracyM} >= 0`),
  ],
);

// DECISION-PENDING: D30 — photos optional, one façade photo.
export const entityPhotos = app.table(
  "entity_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    kind: photoKind("kind").notNull().default("facade"),
    /** Object path in the private Supabase Storage bucket. */
    storagePath: text("storage_path").notNull().unique(),
    bytes: integer("bytes").notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }),
    uploadedByAgentId: uuid("uploaded_by_agent_id").references(() => agents.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("entity_photos_entity_idx").on(t.entityId)],
);

// DECISION-PENDING: D4 — exemptions are recorded here by an admin; nothing is automatic.
export const exemptions = app.table(
  "exemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taxpayerId: uuid("taxpayer_id")
      .notNull()
      .references(() => taxpayers.id),
    /** Null = every tax. */
    taxRuleId: uuid("tax_rule_id").references(() => taxRules.id),
    reason: text("reason").notNull(),
    referenceDocument: text("reference_document"),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    grantedByAdminId: uuid("granted_by_admin_id").references(() => admins.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("exemptions_taxpayer_idx").on(t.taxpayerId)],
);
