import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createPhotoUploadUrl, registerPhoto } from "@/lib/census/photos";
import { agents, auditLog, devices, entities, entityPhotos, taxpayers } from "@/lib/db/schema";
import type { AgentSession } from "@/lib/identity/agent-session";

import { appDb } from "./db";

async function sessionFor(matricule: string): Promise<AgentSession> {
  const db = appDb();
  const [agent] = await db.select().from(agents).where(eq(agents.matricule, matricule));
  const [device] = await db.select().from(devices).where(eq(devices.agentId, agent!.id));
  return {
    agentId: agent!.id,
    matricule,
    fullName: agent!.fullName,
    zoneId: agent!.zoneId,
    communeId: agent!.communeId,
    deviceId: device!.id,
    deviceCode: device!.deviceCode,
  };
}

describe("census photos", () => {
  it("records a photo against an entity with an audit row, and ignores a duplicate path", async () => {
    const db = appDb();
    const session = await sessionFor("AG-KAM-007");
    const [tp] = await db
      .select({ id: taxpayers.id })
      .from(taxpayers)
      .where(eq(taxpayers.taxpayerNo, "LUB-KAM-00000127"));
    const [entity] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(eq(entities.taxpayerId, tp!.id));
    const path = `LUB-KAM-00000127/facade-test-${Date.now()}.jpg`;
    const first = await registerPhoto(db, session, {
      entityId: entity!.id,
      kind: "facade",
      storagePath: path,
      bytes: 120_000,
    });
    expect(first?.id).toBeTruthy();
    const again = await registerPhoto(db, session, {
      entityId: entity!.id,
      kind: "facade",
      storagePath: path,
      bytes: 120_000,
    });
    expect(again?.id).toBeNull();
    const rows = await db.select().from(entityPhotos).where(eq(entityPhotos.storagePath, path));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.uploadedByAgentId).toBe(session.agentId);
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "entity.photo_added"), eq(auditLog.objectId, entity!.id)));
    expect(audit?.deviceId).toBe(session.deviceId);
    await expect(
      registerPhoto(db, session, {
        entityId: entity!.id,
        kind: "facade",
        storagePath: "x.jpg",
        bytes: 400 * 1024,
      }),
    ).rejects.toThrow();
    expect(
      await registerPhoto(db, session, {
        entityId: "00000000-0000-0000-0000-000000000000",
        kind: "facade",
        storagePath: "y.jpg",
        bytes: 1,
      }),
    ).toBeNull();
  });

  it.skipIf(!process.env.SUPABASE_SECRET_KEY)(
    "signs a one-shot upload URL in the private bucket",
    async () => {
      const db = appDb();
      const session = await sessionFor("AG-KAM-007");
      const [tp] = await db
        .select({ id: taxpayers.id })
        .from(taxpayers)
        .where(eq(taxpayers.taxpayerNo, "LUB-KAM-00000127"));
      const [entity] = await db
        .select({ id: entities.id })
        .from(entities)
        .where(eq(entities.taxpayerId, tp!.id));
      const url = await createPhotoUploadUrl(db, session, { entityId: entity!.id, kind: "person" });
      expect(url?.storagePath).toMatch(/^LUB-KAM-00000127\/person-/);
      expect(url?.signedUrl).toContain("/storage/v1/object/upload/sign/photos/");
    },
  );
});
