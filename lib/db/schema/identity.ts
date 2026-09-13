import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { adminRole, agentStatus, app, deviceStatus } from "./enums";
import { zones } from "./zones";

/** Admin users authenticate with Supabase Auth (M3); `auth_user_id` links to auth.users. */
export const admins = app.table("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  authUserId: uuid("auth_user_id").unique(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  role: adminRole("role").notNull(),
  active: boolean("active").notNull().default(true),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Key/value configuration editable by an Administrateur (e.g. `rule_version_approval`:
 * which roles may approve a tax rule version and whether self-approval is forbidden).
 */
export const settings = app.table("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedByAdminId: uuid("updated_by_admin_id").references((): AnyPgColumn => admins.id),
});

/** Field agents: matricule + PIN, one assigned zone, registered devices. */
export const agents = app.table("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  matricule: text("matricule").notNull().unique(),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  pinHash: text("pin_hash").notNull(),
  zoneId: uuid("zone_id")
    .notNull()
    .references(() => zones.id),
  communeId: uuid("commune_id")
    .notNull()
    .references(() => zones.id),
  status: agentStatus("status").notNull().default("active"),
  failedPinAttempts: integer("failed_pin_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** A device is a self-issued token bound to an agent; revocation is server-side. */
export const devices = app.table(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceCode: text("device_code").notNull().unique(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    label: text("label"),
    userAgent: text("user_agent"),
    secretHash: text("secret_hash"),
    status: deviceStatus("status").notNull().default("active"),
    registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
    revokedByAdminId: uuid("revoked_by_admin_id").references(() => admins.id),
  },
  (t) => [index("devices_agent_idx").on(t.agentId)],
);

/** "Ma tournée": a named route in a zone, made of entities, assigned to an agent per day. */
export const agentRoutes = app.table("agent_routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  zoneId: uuid("zone_id")
    .notNull()
    .references(() => zones.id),
  createdByAdminId: uuid("created_by_admin_id").references(() => admins.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const routeEntities = app.table(
  "route_entities",
  {
    routeId: uuid("route_id")
      .notNull()
      .references(() => agentRoutes.id),
    entityId: uuid("entity_id").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [unique("route_entities_uniq").on(t.routeId, t.entityId)],
);

export const routeAssignments = app.table(
  "route_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    routeId: uuid("route_id")
      .notNull()
      .references(() => agentRoutes.id),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    assignedOn: date("assigned_on").notNull(),
    assignedByAdminId: uuid("assigned_by_admin_id").references(() => admins.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("route_assignments_uniq").on(t.routeId, t.agentId, t.assignedOn)],
);

/** Signed portal links (`/t/<token>`): only the token hash is stored. */
export const portalLinks = app.table(
  "portal_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taxpayerId: uuid("taxpayer_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    purpose: text("purpose").notNull().default("portal"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("portal_links_taxpayer_idx").on(t.taxpayerId)],
);
