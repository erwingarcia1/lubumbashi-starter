import { eq } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "@/lib/audit/write";
import type { Db } from "@/lib/db/client";
import { taxpayers } from "@/lib/db/schema";
import type { AgentSession } from "@/lib/identity/agent-session";

const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/);

/** Contact fields an agent may change (CLAUDE.md invariant 2: register, update contact, initiate). */
export const agentContactInput = z.strictObject({
  taxpayerNo: z.string().regex(/^LUB-[A-Z]{3}-\d{8}$/),
  /** Client UUID of the outbox item, kept in the audit row (offline updates, M8). */
  clientUuid: z.uuid().optional(),
  phone: e164.optional(),
  address: z.string().trim().min(3).max(200).optional(),
  gps: z.object({ lng: z.number(), lat: z.number() }).optional(),
});
export type AgentContactInput = z.infer<typeof agentContactInput>;

export class ContactError extends Error {
  constructor(readonly code: "not_found" | "nothing_to_update") {
    super(code);
    this.name = "ContactError";
  }
}

/** Idempotent: applying the same update twice changes nothing the second time (still audited). */
export async function updateContactAsAgent(
  db: Db,
  session: AgentSession,
  raw: AgentContactInput,
  now = new Date(),
) {
  const input = agentContactInput.parse(raw);
  if (input.phone === undefined && input.address === undefined)
    throw new ContactError("nothing_to_update");
  return db.transaction(async (tx) => {
    const [tp] = await tx
      .select()
      .from(taxpayers)
      .where(eq(taxpayers.taxpayerNo, input.taxpayerNo));
    if (!tp || tp.status !== "active") throw new ContactError("not_found");
    const changes: Partial<typeof taxpayers.$inferInsert> = {};
    if (input.phone !== undefined && input.phone !== tp.phone) changes.phone = input.phone;
    if (input.address !== undefined && input.address !== tp.address)
      changes.address = input.address;
    if (Object.keys(changes).length > 0) {
      await tx
        .update(taxpayers)
        .set({ ...changes, updatedAt: now })
        .where(eq(taxpayers.id, tp.id));
    }
    await writeAudit(tx, {
      actor: { type: "agent", id: session.agentId, role: "agent", label: session.matricule },
      action: "taxpayer.contact_updated",
      object: { type: "taxpayer", id: tp.taxpayerNo },
      details: {
        before: { phone: tp.phone, address: tp.address },
        after: { phone: changes.phone ?? tp.phone, address: changes.address ?? tp.address },
        clientUuid: input.clientUuid ?? null,
      },
      where: input.gps ? { gps: input.gps } : undefined,
      device: { id: session.deviceId },
    });
    return {
      taxpayerNo: tp.taxpayerNo,
      phone: changes.phone ?? tp.phone,
      address: changes.address ?? tp.address,
      changed: Object.keys(changes),
    };
  });
}
