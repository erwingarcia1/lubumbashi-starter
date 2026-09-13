import { hash, verify } from "@node-rs/argon2";
import { and, eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { writeAudit } from "@/lib/audit/write";
import type { Db } from "@/lib/db/client";
import { agents, devices, zones } from "@/lib/db/schema";

export const MAX_PIN_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

export type AgentLoginErrorCode = "invalid_credentials" | "locked" | "suspended" | "device_revoked";

export class AgentLoginError extends Error {
  constructor(readonly code: AgentLoginErrorCode) {
    super(code);
    this.name = "AgentLoginError";
  }
}

export const agentLoginInput = z.object({
  matricule: z
    .string()
    .trim()
    .regex(/^AG-[A-Z]{3}-\d{3}$/),
  pin: z.string().regex(/^\d{6}$/),
  device: z.object({
    code: z.string().trim().max(20).optional(),
    secret: z.string().trim().max(128).optional(),
    label: z.string().trim().max(80).optional(),
  }),
  gps: z.object({ lng: z.number(), lat: z.number() }).optional(),
});
export type AgentLoginInput = z.infer<typeof agentLoginInput>;

export interface AgentLoginResult {
  agentId: string;
  matricule: string;
  fullName: string;
  zoneName: string;
  communeName: string;
  device: { id: string; code: string; label: string | null; secret?: string };
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Decides the lock state from the counter and clock (pure, unit-tested). */
export function lockState(
  agent: { failedPinAttempts: number; lockedUntil: Date | null },
  now: Date,
): "open" | "locked" {
  if (agent.lockedUntil && agent.lockedUntil.getTime() > now.getTime()) return "locked";
  return "open";
}

/**
 * Matricule + PIN + device. A new device (no code, or unknown code/secret) is registered on
 * first login and its secret returned once; a revoked device is refused. Five wrong PINs lock
 * the agent for 15 minutes. Everything is audited with the device and GPS when given.
 */
export async function loginAgent(
  db: Db,
  raw: AgentLoginInput,
  ctx: { userAgent?: string; ip?: string } = {},
  now = new Date(),
): Promise<AgentLoginResult> {
  const input = agentLoginInput.parse(raw);
  const [agent] = await db.select().from(agents).where(eq(agents.matricule, input.matricule));
  if (!agent) throw new AgentLoginError("invalid_credentials");
  if (agent.status !== "active") throw new AgentLoginError("suspended");
  if (lockState(agent, now) === "locked") throw new AgentLoginError("locked");

  const ok = await verify(agent.pinHash, input.pin);
  if (!ok) {
    const attempts = agent.failedPinAttempts + 1;
    const lock = attempts >= MAX_PIN_ATTEMPTS;
    await db
      .update(agents)
      .set({
        failedPinAttempts: lock ? 0 : attempts,
        lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null,
        updatedAt: now,
      })
      .where(eq(agents.id, agent.id));
    await writeAudit(db, {
      actor: { type: "agent", id: agent.id, role: "agent", label: agent.matricule },
      action: lock ? "agent.locked" : "agent.login_failed",
      object: { type: "agent", id: agent.matricule },
      details: { attempts },
      where: input.gps ? { gps: input.gps } : ctx.ip ? { ip: ctx.ip } : undefined,
      device: ctx.userAgent ? { userAgent: ctx.userAgent } : undefined,
    });
    throw new AgentLoginError(lock ? "locked" : "invalid_credentials");
  }

  return db.transaction(async (tx) => {
    let device: typeof devices.$inferSelect | undefined;
    let issuedSecret: string | undefined;
    if (input.device.code) {
      const [known] = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.deviceCode, input.device.code), eq(devices.agentId, agent.id)));
      if (known) {
        if (known.status === "revoked") throw new AgentLoginError("device_revoked");
        const secretOk =
          known.secretHash === null ||
          (input.device.secret !== undefined && sha256(input.device.secret) === known.secretHash);
        if (secretOk) device = known;
      }
    }
    if (!device) {
      issuedSecret = randomBytes(24).toString("base64url");
      const code = `DEV-${randomBytes(2).toString("hex").toUpperCase()}`;
      [device] = await tx
        .insert(devices)
        .values({
          deviceCode: code,
          agentId: agent.id,
          label: input.device.label ?? null,
          userAgent: ctx.userAgent ?? null,
          secretHash: sha256(issuedSecret),
          registeredAt: now,
          lastSeenAt: now,
        })
        .returning();
      await writeAudit(tx, {
        actor: { type: "agent", id: agent.id, role: "agent", label: agent.matricule },
        action: "device.registered",
        object: { type: "device", id: device!.deviceCode },
        details: { label: input.device.label ?? null },
        where: input.gps ? { gps: input.gps } : ctx.ip ? { ip: ctx.ip } : undefined,
        device: { id: device!.id },
      });
    } else {
      await tx
        .update(devices)
        .set({ lastSeenAt: now, userAgent: ctx.userAgent ?? device.userAgent })
        .where(eq(devices.id, device.id));
    }
    await tx
      .update(agents)
      .set({ failedPinAttempts: 0, lockedUntil: null, updatedAt: now })
      .where(eq(agents.id, agent.id));
    await writeAudit(tx, {
      actor: { type: "agent", id: agent.id, role: "agent", label: agent.matricule },
      action: "agent.logged_in",
      object: { type: "agent", id: agent.matricule },
      where: input.gps ? { gps: input.gps } : ctx.ip ? { ip: ctx.ip } : undefined,
      device: { id: device!.id },
    });
    const [zone] = await tx
      .select({ name: zones.name })
      .from(zones)
      .where(eq(zones.id, agent.zoneId));
    const [commune] = await tx
      .select({ name: zones.name })
      .from(zones)
      .where(eq(zones.id, agent.communeId));
    return {
      agentId: agent.id,
      matricule: agent.matricule,
      fullName: agent.fullName,
      zoneName: zone?.name ?? "",
      communeName: commune?.name ?? "",
      device: {
        id: device!.id,
        code: device!.deviceCode,
        label: device!.label,
        secret: issuedSecret,
      },
    };
  });
}

export async function hashPin(pin: string): Promise<string> {
  return hash(pin);
}
