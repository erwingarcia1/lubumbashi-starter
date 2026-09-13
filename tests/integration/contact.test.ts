import { and, desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { agents, auditLog, devices, taxpayers } from "@/lib/db/schema";
import { updateContactAsAgent } from "@/lib/census/contact";
import type { AgentSession } from "@/lib/identity/agent-session";
import { runSeed } from "@/scripts/seed";

import { appDb } from "./db";

let session: AgentSession;

describe("agent contact update (invariant 2: contact fields only; replayed by the offline outbox)", () => {
  beforeAll(async () => {
    const db = appDb();
    await runSeed(db);
    const [agent] = await db.select().from(agents).where(eq(agents.matricule, "AG-KAM-007"));
    const [device] = await db.select().from(devices).where(eq(devices.deviceCode, "DEV-3F9A"));
    session = {
      agentId: agent!.id,
      matricule: agent!.matricule,
      fullName: agent!.fullName,
      zoneId: agent!.zoneId,
      communeId: agent!.communeId,
      deviceId: device!.id,
      deviceCode: device!.deviceCode,
    };
  });

  it("changes phone and address, audits WHO/WHAT/DEVICE with the client UUID, and is idempotent", async () => {
    const db = appDb();
    const no = "LUB-KAM-00000131";
    const [before] = await db.select().from(taxpayers).where(eq(taxpayers.taxpayerNo, no));
    const clientUuid = crypto.randomUUID();
    const first = await updateContactAsAgent(db, session, {
      taxpayerNo: no,
      clientUuid,
      phone: "+243991110000",
      address: "Av. Kasaï 240",
      gps: { lng: 27.49, lat: -11.66 },
    });
    expect(first.changed.sort()).toEqual(["address", "phone"]);
    const second = await updateContactAsAgent(db, session, {
      taxpayerNo: no,
      clientUuid,
      phone: "+243991110000",
      address: "Av. Kasaï 240",
    });
    expect(second.changed).toEqual([]);
    const [after] = await db.select().from(taxpayers).where(eq(taxpayers.taxpayerNo, no));
    expect(after!.phone).toBe("+243991110000");
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "taxpayer.contact_updated"), eq(auditLog.objectId, no)))
      .orderBy(desc(auditLog.createdAt))
      .limit(1);
    expect(audit!.actorType).toBe("agent");
    expect(audit!.deviceId).toBe(session.deviceId);
    expect((audit!.details as { clientUuid: string }).clientUuid).toBe(clientUuid);
    // Restore the seeded values (the seed does not overwrite existing rows).
    await updateContactAsAgent(db, session, {
      taxpayerNo: no,
      phone: before!.phone,
      address: before!.address,
    });
  });

  it("refuses unknown taxpayers and empty updates", async () => {
    const db = appDb();
    await expect(
      updateContactAsAgent(db, session, { taxpayerNo: "LUB-KAM-99999999", phone: "+243991110000" }),
    ).rejects.toThrow(/not_found/);
    await expect(
      updateContactAsAgent(db, session, { taxpayerNo: "LUB-KAM-00000131" }),
    ).rejects.toThrow(/nothing_to_update/);
  });
});
