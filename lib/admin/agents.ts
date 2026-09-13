import { z } from "zod";
import { hash } from "@node-rs/argon2";
import { eq, sql } from "drizzle-orm";

import { writeAudit } from "@/lib/audit/write";
import type { Db, Tx } from "@/lib/db/client";
import { agents, devices, zones } from "@/lib/db/schema";
import type { AdminSession } from "@/lib/identity/session";

import { actorOf, deviceOf, whereOf, type RequestContext } from "./context";
import { AdminError } from "./errors";

export const OUT_OF_ZONE_M = 2000;

export interface AgentRow {
  id: string;
  matricule: string;
  fullName: string;
  zone: string;
  registered: number;
  collections: number;
  amountFc: number;
  attempts7d: number;
  failureRate7d: number | null;
  duplicates: number;
  outOfZone: number;
  lastSeenAt: Date | null;
  status: "active" | "suspended";
  devices: Array<{
    id: string;
    code: string;
    label: string | null;
    status: "active" | "revoked";
    lastSeenAt: Date | null;
    revokedAt: Date | null;
    revokedReason: string | null;
  }>;
}

/**
 * d-agents: the two classic patterns — failure rate over 7 days (cash taken, request left to
 * fail) and registrations far from the zone (invented households, measured against the
 * centroid of the zone's own registrations).
 */
export async function agentsTable(db: Db, now = new Date()): Promise<AgentRow[]> {
  const rows = (
    await db.execute<{
      id: string;
      matricule: string;
      full_name: string;
      zone: string;
      status: "active" | "suspended";
      registered: number;
      collections: number;
      amount: number;
      attempts: number;
      failures: number;
      duplicates: number;
      out_of_zone: number;
      last_seen: Date | null;
    }>(sql`
      with zone_center as (
        select e.quartier_id, extensions.ST_Centroid(extensions.ST_Collect(e.location)) as c
        from app.entities e where e.quartier_id is not null group by e.quartier_id
      )
      select a.id, a.matricule, a.full_name, z.name as zone, a.status,
             (select count(*) from app.taxpayers t where t.registered_by_agent_id = a.id)::int as registered,
             (select count(*) from app.payments p where p.initiated_by_agent_id = a.id and p.status = 'confirmed')::int as collections,
             (select coalesce(sum(p.amount_fc), 0) from app.payments p where p.initiated_by_agent_id = a.id and p.status = 'confirmed')::int as amount,
             (select count(*) from app.payments p where p.initiated_by_agent_id = a.id and p.status in ('confirmed','failed') and p.business_date >= (${sql.raw(`'${now.toISOString().slice(0, 10)}'`)}::date - 7))::int as attempts,
             (select count(*) from app.payments p where p.initiated_by_agent_id = a.id and p.status = 'failed' and p.business_date >= (${sql.raw(`'${now.toISOString().slice(0, 10)}'`)}::date - 7))::int as failures,
             (select count(*) from app.taxpayers t where t.registered_by_agent_id = a.id and exists (select 1 from app.taxpayers u where u.phone = t.phone and u.id <> t.id))::int as duplicates,
             (select count(*) from app.entities e join zone_center zc on zc.quartier_id = a.zone_id
               where e.registered_by_agent_id = a.id
                 and extensions.ST_Distance(extensions.ST_SetSRID(e.location, 4326)::extensions.geography, extensions.ST_SetSRID(zc.c, 4326)::extensions.geography) > ${OUT_OF_ZONE_M})::int as out_of_zone,
             (select max(d.last_seen_at) from app.devices d where d.agent_id = a.id) as last_seen
      from app.agents a join app.zones z on z.id = a.zone_id
      order by a.matricule`)
  ).rows;
  const deviceRows = await db.select().from(devices);
  return rows.map((r) => ({
    id: r.id,
    matricule: r.matricule,
    fullName: r.full_name,
    zone: r.zone,
    registered: Number(r.registered),
    collections: Number(r.collections),
    amountFc: Number(r.amount),
    attempts7d: Number(r.attempts),
    failureRate7d:
      Number(r.attempts) > 0 ? Math.round((Number(r.failures) / Number(r.attempts)) * 100) : null,
    duplicates: Number(r.duplicates),
    outOfZone: Number(r.out_of_zone),
    lastSeenAt: r.last_seen ? new Date(r.last_seen) : null,
    status: r.status,
    devices: deviceRows
      .filter((d) => d.agentId === r.id)
      .map((d) => ({
        id: d.id,
        code: d.deviceCode,
        label: d.label,
        status: d.status,
        lastSeenAt: d.lastSeenAt,
        revokedAt: d.revokedAt,
        revokedReason: d.revokedReason,
      })),
  }));
}

/** Administrateur or Superviseur revoke a device with a reason; the agent is logged out on the next request. */
export async function revokeDevice(
  db: Db,
  session: AdminSession,
  input: { deviceId: string; reason: string },
  ctx: RequestContext = {},
): Promise<void> {
  if (session.role !== "administrateur" && session.role !== "superviseur")
    throw new AdminError("forbidden");
  const reason = input.reason.trim();
  if (reason.length < 3) throw new AdminError("invalid_input", "reason required");
  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(devices).where(eq(devices.id, input.deviceId));
    if (!d) throw new AdminError("not_found", input.deviceId);
    if (d.status === "revoked") throw new AdminError("invalid_state", "already revoked");
    await tx
      .update(devices)
      .set({
        status: "revoked",
        revokedAt: new Date(),
        revokedReason: reason,
        revokedByAdminId: session.adminId,
      })
      .where(eq(devices.id, d.id));
    await tx.execute(sql`
      insert into app.audit_log (actor_type, actor_id, actor_role, actor_label, action, object_type, object_id, details, reason, ip, user_agent)
      values ('admin', ${session.adminId}, ${session.role}, ${session.email}, 'device.revoked', 'device', ${d.deviceCode},
              ${JSON.stringify({ agentId: d.agentId, deviceId: d.id })}::jsonb, ${reason}, ${ctx.ip ?? null}::inet, ${ctx.userAgent ?? null})`);
  });
}

// --- Agent accounts (created by the Mairie, never self-registered) -----------------------------

const PIN = z.string().regex(/^\d{6}$/, "PIN must be 6 digits");

export const createAgentInput = z.object({
  fullName: z.string().trim().min(3).max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** Quartier (zone of the agent); its commune is derived from the zone tree. */
  quartierId: z.uuid(),
  pin: PIN,
});
export type CreateAgentInput = z.infer<typeof createAgentInput>;

/** Administrateur and Superviseur manage agent accounts (docs/ROLES.md). */
export function canManageAgents(role: AdminSession["role"]): boolean {
  return role === "administrateur" || role === "superviseur";
}

/** Communes with their quartiers, for the agent form. */
export async function zonesForAgents(db: Db) {
  const rows = await db
    .select({
      id: zones.id,
      level: zones.level,
      code: zones.code,
      name: zones.name,
      parentId: zones.parentId,
    })
    .from(zones)
    .orderBy(zones.level, zones.name);
  const communes = rows.filter((z) => z.level === "commune");
  return communes.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    quartiers: rows
      .filter((q) => q.level === "quartier" && q.parentId === c.id)
      .map((q) => ({ id: q.id, code: q.code, name: q.name })),
  }));
}

/** Next `AG-<COMMUNE3>-NNN` for a commune (gap-free after the highest existing number). */
async function nextMatricule(tx: Tx, communeCode: string): Promise<string> {
  const prefix = `AG-${communeCode}-`;
  const [row] = await tx
    .execute<{ last: string | null }>(
      sql`
    select max(substr(matricule, ${prefix.length + 1}::int)::int)::text as last
    from app.agents where matricule like ${`${prefix}%`} and substr(matricule, ${prefix.length + 1}::int) ~ '^[0-9]+$'
  `,
    )
    .then((r) => r.rows);
  const n = (row?.last ? Number(row.last) : 0) + 1;
  return `${prefix}${String(n).padStart(3, "0")}`;
}

export async function createAgent(
  db: Db,
  session: AdminSession,
  raw: CreateAgentInput,
  ctx: RequestContext = {},
): Promise<{ id: string; matricule: string }> {
  if (!canManageAgents(session.role)) throw new AdminError("forbidden");
  const input = createAgentInput.parse(raw);
  const [quartier] = await db.select().from(zones).where(eq(zones.id, input.quartierId));
  if (!quartier || quartier.level !== "quartier" || !quartier.parentId)
    throw new AdminError("invalid_input", "quartier required");
  const [commune] = await db.select().from(zones).where(eq(zones.id, quartier.parentId));
  if (!commune) throw new AdminError("invalid_state", "quartier without commune");
  const pinHash = await hash(input.pin);
  return db.transaction(async (tx) => {
    const matricule = await nextMatricule(tx, commune.code);
    const [created] = await tx
      .insert(agents)
      .values({
        matricule,
        fullName: input.fullName,
        phone: input.phone ?? null,
        pinHash,
        zoneId: quartier.id,
        communeId: commune.id,
      })
      .returning({ id: agents.id, matricule: agents.matricule });
    await writeAudit(tx, {
      actor: actorOf(session),
      action: "agent.created",
      object: { type: "agent", id: created!.matricule },
      details: { fullName: input.fullName, zone: quartier.code, commune: commune.code },
      where: whereOf(ctx),
      device: deviceOf(ctx),
    });
    return created!;
  });
}

/** A new PIN chosen by the Mairie (the old one stops working at once; lockout counters reset). */
export async function resetAgentPin(
  db: Db,
  session: AdminSession,
  input: { agentId: string; pin: string },
  ctx: RequestContext = {},
): Promise<{ matricule: string }> {
  if (!canManageAgents(session.role)) throw new AdminError("forbidden");
  const pin = PIN.parse(input.pin);
  const [agent] = await db.select().from(agents).where(eq(agents.id, input.agentId));
  if (!agent) throw new AdminError("not_found", input.agentId);
  const pinHash = await hash(pin);
  await db.transaction(async (tx) => {
    await tx
      .update(agents)
      .set({ pinHash, failedPinAttempts: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(agents.id, agent.id));
    await writeAudit(tx, {
      actor: actorOf(session),
      action: "agent.pin_reset",
      object: { type: "agent", id: agent.matricule },
      details: {},
      where: whereOf(ctx),
      device: deviceOf(ctx),
    });
  });
  return { matricule: agent.matricule };
}
