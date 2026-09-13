import { and, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

export interface AuditFilters {
  /** Business dates, inclusive (YYYY-MM-DD). */
  from?: string;
  to?: string;
  /** Matches the actor label (matricule, e-mail) or "système". */
  actor?: string;
  /** Prefix of the action (`payment.`, `taxpayer.contact_updated`…). */
  action?: string;
  /** Object id (taxpayer number, reference, receipt…). */
  object?: string;
  limit?: number;
  offset?: number;
}

export interface AuditRow {
  id: number;
  at: Date;
  actorType: "admin" | "agent" | "system" | "taxpayer";
  actorLabel: string | null;
  actorRole: string | null;
  action: string;
  objectType: string;
  objectId: string;
  details: unknown;
  reason: string | null;
  gps: { x: number; y: number } | null;
  ip: string | null;
  deviceCode: string | null;
  userAgent: string | null;
}

function whereOf(f: AuditFilters) {
  const clauses = [];
  if (f.from) clauses.push(gte(auditLog.businessDate, f.from));
  if (f.to) clauses.push(lt(auditLog.businessDate, sql`${f.to}::date + 1`));
  if (f.actor)
    clauses.push(
      or(ilike(auditLog.actorLabel, `%${f.actor}%`), ilike(auditLog.actorRole, `%${f.actor}%`)),
    );
  if (f.action) clauses.push(ilike(auditLog.action, `${f.action}%`));
  if (f.object) clauses.push(ilike(auditLog.objectId, `%${f.object}%`));
  return clauses.length ? and(...clauses) : undefined;
}

/** d-audit: newest first, WHO + WHAT + WHEN + WHERE + DEVICE. Read-only by construction. */
export async function auditJournal(
  db: Db,
  f: AuditFilters = {},
): Promise<{ rows: AuditRow[]; total: number }> {
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 5000);
  const offset = Math.max(f.offset ?? 0, 0);
  const where = whereOf(f);
  const rows = await db
    .select({
      id: auditLog.id,
      at: auditLog.createdAt,
      actorType: auditLog.actorType,
      actorLabel: auditLog.actorLabel,
      actorRole: auditLog.actorRole,
      action: auditLog.action,
      objectType: auditLog.objectType,
      objectId: auditLog.objectId,
      details: auditLog.details,
      reason: auditLog.reason,
      gps: auditLog.gps,
      ip: auditLog.ip,
      deviceCode: sql<
        string | null
      >`(select device_code from app.devices d where d.id = ${auditLog.deviceId})`,
      userAgent: auditLog.userAgent,
    })
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit)
    .offset(offset);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(where);
  return {
    rows: rows.map((r) => ({
      ...r,
      gps: r.gps ? { x: r.gps.x, y: r.gps.y } : null,
    })),
    total: count?.n ?? 0,
  };
}

/** One line per row, RFC 4180 quoting, UTF-8 with BOM so Excel opens accents correctly. */
export function auditCsv(rows: AuditRow[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "horodatage",
    "acteur_type",
    "acteur",
    "role",
    "action",
    "objet_type",
    "objet",
    "motif",
    "gps",
    "ip",
    "appareil",
    "user_agent",
    "details",
  ];
  const lines = rows.map((r) =>
    [
      r.at.toISOString(),
      r.actorType,
      r.actorLabel,
      r.actorRole,
      r.action,
      r.objectType,
      r.objectId,
      r.reason,
      r.gps ? `${r.gps.y.toFixed(5)}, ${r.gps.x.toFixed(5)}` : "",
      r.ip,
      r.deviceCode,
      r.userAgent,
      JSON.stringify(r.details ?? {}),
    ]
      .map(esc)
      .join(","),
  );
  return `﻿${[header.join(","), ...lines].join("\r\n")}\r\n`;
}

/** Devices referenced by audit rows are read through `deviceCode`; keep the import used. */
export { eq };
