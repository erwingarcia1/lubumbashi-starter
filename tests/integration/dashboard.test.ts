import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { agentsTable, revokeDevice } from "@/lib/admin/agents";
import { collectionsReport } from "@/lib/admin/collections";
import { mapPoints } from "@/lib/admin/map";
import { overview } from "@/lib/admin/stats";
import { admins, agents, auditLog, devices } from "@/lib/db/schema";
import type { AdminSession } from "@/lib/identity/session";
import { runSeed } from "@/scripts/seed";

import { appDb } from "./db";

const NOW = new Date("2026-09-13T08:42:00+02:00");

describe("dashboard queries (seeded data as of 13 Sept 2026)", () => {
  beforeAll(async () => {
    await runSeed(appDb());
  }, 120_000);

  it("overview: registered, issued, collected, rate, unpaid, daily series, channel shares, alerts", async () => {
    const o = await overview(appDb(), { month: "2026-09" }, NOW);
    expect(o.registered).toBeGreaterThanOrEqual(6);
    expect(o.issuedFc).toBeGreaterThan(0);
    expect(o.collectedFc).toBeGreaterThanOrEqual(45_000); // 03/09 40 000 + 04/09 5 000 from the prototype history
    expect(o.rate).toBe(Math.round((o.collectedFc / o.issuedFc) * 100));
    expect(o.unpaidFc).toBeGreaterThan(0);
    expect(o.unpaidTaxpayers).toBeGreaterThanOrEqual(2);
    expect(o.daily).toHaveLength(14);
    expect(o.daily[13]?.day).toBe("2026-09-13");
    expect(o.daily.find((d) => d.day === "2026-09-04")?.amountFc).toBeGreaterThanOrEqual(5000);
    expect(o.byChannel.reduce((s, c) => s + c.pct, 0)).toBeGreaterThanOrEqual(99);
    expect(o.alerts.reconciliationExceptions).toBe(0);
    const kam = await overview(
      appDb(),
      { month: "2026-09", communeCode: "KAM", taxCode: "assainissement" },
      NOW,
    );
    expect(kam.registered).toBe(o.registered);
    const empty = await overview(appDb(), { month: "2026-09", communeCode: "ANN" }, NOW);
    expect(empty.registered).toBe(0);
    expect(empty.byChannel).toEqual([]);
  });

  it("collections: by commune, by tax, and the receipt rows with filters", async () => {
    const r = await collectionsReport(appDb(), { from: "2026-08-01", to: "2026-09-13" });
    expect(r.byCommune.find((c) => c.commune === "Kampemba")?.collectedFc).toBeGreaterThan(0);
    expect(r.byTax.some((x) => x.taxCode === "assainissement")).toBe(true);
    expect(r.rows.length).toBeGreaterThanOrEqual(5);
    expect(r.rows.every((row) => row.at >= new Date("2026-08-01T00:00:00+02:00"))).toBe(true);
    const failed = r.rows.find((row) => row.status === "failed");
    expect(failed?.receiptNo).toBeNull();
    const orange = await collectionsReport(appDb(), {
      from: "2026-08-01",
      to: "2026-09-13",
      channel: "orange",
    });
    expect(orange.rows.every((row) => row.channel === "orange")).toBe(true);
    const byAgent = await collectionsReport(appDb(), {
      from: "2026-06-01",
      to: "2026-09-13",
      agentMatricule: "AG-KAM-007",
    });
    expect(byAgent.rows.length).toBeGreaterThanOrEqual(2);
    expect(byAgent.rows.every((row) => row.agentMatricule === "AG-KAM-007")).toBe(true);
    expect(
      (
        await collectionsReport(appDb(), {
          from: "2026-08-01",
          to: "2026-09-13",
          communeCode: "ANN",
        })
      ).rows,
    ).toEqual([]);
  });

  it("agents: counts, 7-day failure rate, duplicates, out-of-zone, devices; revocation is audited and role-checked", async () => {
    const db = appDb();
    const rows = await agentsTable(db, NOW);
    const ag007 = rows.find((r) => r.matricule === "AG-KAM-007")!;
    expect(ag007.registered).toBeGreaterThanOrEqual(6);
    expect(ag007.collections).toBeGreaterThanOrEqual(2);
    expect(ag007.devices.some((d) => d.code === "DEV-3F9A" && d.status === "active")).toBe(true);
    const ag011 = rows.find((r) => r.matricule === "AG-KAM-011")!;
    expect(ag011.devices.some((d) => d.code === "DEV-9C21" && d.status === "revoked")).toBe(true);

    const [agent] = await db.select().from(agents).where(eq(agents.matricule, "AG-KAM-019"));
    const [device] = await db
      .insert(devices)
      .values({
        deviceCode: `DEV-T${String(Date.now()).slice(-3)}`,
        agentId: agent!.id,
        label: "test",
      })
      .returning();
    const [adminRow] = await db
      .select()
      .from(admins)
      .where(eq(admins.email, "admin@lubumbashi.cd"));
    const [auditor] = await db
      .select()
      .from(admins)
      .where(eq(admins.email, "auditeur@lubumbashi.cd"));
    const admin: AdminSession = {
      adminId: adminRow!.id,
      authUserId: "x",
      email: adminRow!.email,
      fullName: adminRow!.fullName,
      role: "administrateur",
    };
    const aud: AdminSession = {
      adminId: auditor!.id,
      authUserId: "x",
      email: auditor!.email,
      fullName: auditor!.fullName,
      role: "auditeur",
    };
    await expect(
      revokeDevice(db, aud, { deviceId: device!.id, reason: "test" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      revokeDevice(db, admin, { deviceId: device!.id, reason: "" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await revokeDevice(
      db,
      admin,
      { deviceId: device!.id, reason: "Perte déclarée (test)" },
      { ip: "41.243.0.1" },
    );
    const [after] = await db.select().from(devices).where(eq(devices.id, device!.id));
    expect(after?.status).toBe("revoked");
    expect(after?.revokedByAdminId).toBe(admin.adminId);
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.objectId, device!.deviceCode));
    expect(audit?.action).toBe("device.revoked");
    expect(audit?.reason).toBe("Perte déclarée (test)");
    await expect(
      revokeDevice(db, admin, { deviceId: device!.id, reason: "again" }),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("map: one coloured point per active entity, filterable by status and agent", async () => {
    const all = await mapPoints(appDb(), { communeCode: "KAM" }, NOW);
    expect(all.length).toBeGreaterThanOrEqual(6);
    const jean = all.find((p) => p.taxpayerNo === "LUB-KAM-00000125")!;
    expect(jean.pill).toBe("late");
    expect(jean.lng).toBeCloseTo(27.493, 3);
    expect(jean.lat).toBeCloseTo(-11.6642, 3);
    const late = await mapPoints(appDb(), { communeCode: "KAM", pill: "late" }, NOW);
    expect(late.every((p) => p.pill === "late")).toBe(true);
    expect(
      (await mapPoints(appDb(), { communeCode: "KAM", agentMatricule: "AG-KAM-019" }, NOW)).length,
    ).toBe(0);
  });
});
