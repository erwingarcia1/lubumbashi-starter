import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { createAgent, resetAgentPin } from "@/lib/admin/agents";
import { admins, agents, auditLog, zones } from "@/lib/db/schema";
import { loginAgent } from "@/lib/identity/agent-auth";
import type { AdminSession } from "@/lib/identity/session";
import { runSeed } from "@/scripts/seed";

import { appDb } from "./db";

let superviseur: AdminSession;
let auditeur: AdminSession;
let quartierId: string;

describe("agent accounts created by the Mairie", () => {
  beforeAll(async () => {
    const db = appDb();
    await runSeed(db);
    const row = async (email: string) =>
      (await db.select().from(admins).where(eq(admins.email, email)))[0]!;
    const s = await row("ilunga.m@lubumbashi.cd");
    const a = await row("auditeur@lubumbashi.cd");
    superviseur = {
      adminId: s.id,
      email: s.email,
      fullName: s.fullName,
      role: s.role,
    } as AdminSession;
    auditeur = {
      adminId: a.id,
      email: a.email,
      fullName: a.fullName,
      role: a.role,
    } as AdminSession;
    const [q] = await db
      .select({ id: zones.id })
      .from(zones)
      .where(and(eq(zones.level, "quartier"), eq(zones.code, "bel-air")));
    quartierId = q!.id;
  });

  it("gives the next matricule of the commune, audits, and the agent can log in with the PIN", async () => {
    const db = appDb();
    const before = await db.select({ m: agents.matricule }).from(agents);
    const max = Math.max(...before.map((r) => Number(r.m.split("-")[2])));
    const created = await createAgent(
      db,
      superviseur,
      { fullName: "Test Agent Nouveau", phone: "+243990001122", quartierId, pin: "654321" },
      { ip: "10.0.0.3", userAgent: "vitest" },
    );
    expect(created.matricule).toBe(`AG-KAM-${String(max + 1).padStart(3, "0")}`);
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "agent.created"), eq(auditLog.objectId, created.matricule)));
    expect(audit!.actorLabel).toBe("ilunga.m@lubumbashi.cd");
    expect(JSON.stringify(audit!.details)).not.toContain("654321");

    const login = await loginAgent(
      db,
      { matricule: created.matricule, pin: "654321", device: { label: "vitest" } },
      { ip: "10.0.0.3" },
    );
    expect(login.agentId).toBe(created.id);

    await resetAgentPin(db, superviseur, { agentId: created.id, pin: "111222" });
    await expect(
      loginAgent(db, { matricule: created.matricule, pin: "654321", device: { label: "vitest" } }),
    ).rejects.toThrow();
    const again = await loginAgent(db, {
      matricule: created.matricule,
      pin: "111222",
      device: { label: "vitest" },
    });
    expect(again.agentId).toBe(created.id);
  });

  it("refuses the auditor, a bad PIN, and an unknown quartier", async () => {
    const db = appDb();
    await expect(
      createAgent(db, auditeur, { fullName: "X Y Z", quartierId, pin: "123456" }),
    ).rejects.toThrow(/forbidden/);
    await expect(
      createAgent(db, superviseur, { fullName: "X Y Z", quartierId, pin: "12" }),
    ).rejects.toThrow();
    await expect(
      createAgent(db, superviseur, {
        fullName: "X Y Z",
        quartierId: "00000000-0000-0000-0000-000000000000",
        pin: "123456",
      }),
    ).rejects.toThrow(/invalid_input/);
  });
});
