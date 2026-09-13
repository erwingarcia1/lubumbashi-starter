import type { Db, Tx } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

import { auditInput, type AuditInput } from "./schema";

/**
 * The only code path that writes audit_log (invariant 4). Pass the transaction of the action
 * being audited so the row and the action commit or roll back together. WHEN is always the
 * database clock (`created_at` default now()), never a client timestamp.
 */
export async function writeAudit(db: Db | Tx, input: AuditInput): Promise<number> {
  const rec = auditInput.parse(input);
  const actorId = "id" in rec.actor ? rec.actor.id : null;
  const actorRole =
    rec.actor.type === "admin" || rec.actor.type === "agent" ? rec.actor.role : null;
  const gps =
    rec.where && "gps" in rec.where ? { x: rec.where.gps.lng, y: rec.where.gps.lat } : null;
  const ip = rec.where && "ip" in rec.where ? rec.where.ip : null;
  const deviceId = rec.device && "id" in rec.device ? rec.device.id : null;
  const userAgent = rec.device && "userAgent" in rec.device ? rec.device.userAgent : null;

  const [row] = await db
    .insert(auditLog)
    .values({
      actorType: rec.actor.type,
      actorId,
      actorRole,
      actorLabel: rec.actor.label ?? null,
      action: rec.action,
      objectType: rec.object.type,
      objectId: rec.object.id,
      details: rec.details,
      gps,
      ip,
      deviceId,
      userAgent,
    })
    .returning({ id: auditLog.id });
  if (!row) throw new Error("audit_log insert returned no row");
  return row.id;
}
