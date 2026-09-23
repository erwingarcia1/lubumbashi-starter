import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { auditJournal } from "@/lib/admin/audit";
import { admins } from "@/lib/db/schema";
import type { AdminSession } from "@/lib/identity/session";
import { buildReport, REPORT_CODES, REPORTS } from "@/lib/reports";
import { businessDate } from "@/lib/time";
import { runSeed } from "@/scripts/seed";

import { appDb } from "./db";

describe("audit journal and the six reports (M10)", () => {
  beforeAll(async () => {
    await runSeed(appDb());
  });

  it("journal filters by date, actor, action prefix and object; newest first", async () => {
    const db = appDb();
    const all = await auditJournal(db, { limit: 20 });
    expect(all.total).toBeGreaterThan(20);
    expect(all.rows).toHaveLength(20);
    expect(all.rows[0]!.at.getTime()).toBeGreaterThanOrEqual(all.rows[19]!.at.getTime());
    const agent = await auditJournal(db, { actor: "AG-KAM-007", action: "taxpayer.", limit: 500 });
    expect(agent.rows.length).toBeGreaterThan(0);
    expect(
      agent.rows.every((r) => r.action.startsWith("taxpayer.") && r.actorLabel === "AG-KAM-007"),
    ).toBe(true);
    expect(agent.rows[0]!.deviceCode).toMatch(/^DEV-/);
    const obj = await auditJournal(db, { object: "LUB-KAM-00000125", limit: 500 });
    expect(obj.rows.every((r) => r.objectId.includes("LUB-KAM-00000125"))).toBe(true);
    // The seed writes its journal rows at seed time: today's business day has them.
    const today = businessDate(new Date());
    const day = await auditJournal(db, { from: today, to: today, limit: 500 });
    expect(day.rows.length).toBeGreaterThan(0);
    const none = await auditJournal(db, { from: "1999-01-01", to: "1999-01-02" });
    expect(none.total).toBe(0);
  });

  it("every report builds for the seeded data in each of its formats", async () => {
    const db = appDb();
    const now = new Date("2026-09-13T12:00:00+02:00");
    // The print run of the notes de perception issues them, so it needs the issuing admin.
    const [finances] = await db
      .select({ id: admins.id, email: admins.email, fullName: admins.fullName })
      .from(admins)
      .where(eq(admins.email, "ngoy.k@lubumbashi.cd"));
    const caller = {
      session: {
        adminId: finances!.id,
        email: finances!.email,
        fullName: finances!.fullName,
        role: "finances" as const,
      } as AdminSession,
      ctx: { ip: "198.51.100.9", userAgent: "vitest" },
    };
    for (const code of REPORT_CODES) {
      for (const format of REPORTS[code].formats) {
        const file = await buildReport(
          db,
          code,
          { format, month: "2026-09", day: "2026-09-13" },
          now,
          code === "invoices" ? caller : undefined,
        );
        expect(file.filename.endsWith(`.${format}`)).toBe(true);
        expect(file.body.length).toBeGreaterThan(100);
        if (format === "pdf") expect(file.body.subarray(0, 5).toString()).toBe("%PDF-");
        if (format === "xlsx") expect(file.body.subarray(0, 2).toString()).toBe("PK");
        if (format === "csv")
          expect(file.body.toString("utf8").startsWith("﻿horodatage")).toBe(true);
        if (code !== "reconciliation") expect(file.rows).toBeGreaterThan(0);
      }
    }
    await expect(buildReport(db, "unpaid", { format: "pdf" })).rejects.toThrow(/not available/);
  });
});
