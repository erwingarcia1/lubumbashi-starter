import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { writeAudit } from "@/lib/audit/write";
import { auditLog } from "@/lib/db/schema";

import { appDb, ownerDb, pgCode, pgMessage } from "./db";

const agentId = "0f2b7a1c-9d0e-4c5a-8b6d-1e2f3a4b5c6d";

describe("audit_log is append-only (invariant 4)", () => {
  it("writes WHO, WHAT, WHEN (server clock), WHERE and DEVICE", async () => {
    const before = Date.now();
    const id = await writeAudit(appDb(), {
      actor: { type: "agent", id: agentId, role: "agent", label: "AG-TST-001" },
      action: "test.written",
      object: { type: "test", id: "t-1" },
      details: { note: "integration" },
      where: { gps: { lng: 27.493, lat: -11.6642 } },
      device: { userAgent: "vitest" },
    });
    const [row] = await appDb()
      .select()
      .from(auditLog)
      .where(sql`${auditLog.id} = ${id}`);
    expect(row).toBeDefined();
    expect(row!.actorType).toBe("agent");
    expect(row!.actorId).toBe(agentId);
    expect(row!.actorRole).toBe("agent");
    expect(row!.actorLabel).toBe("AG-TST-001");
    expect(row!.action).toBe("test.written");
    expect(row!.objectType).toBe("test");
    expect(row!.details).toEqual({ note: "integration" });
    expect(row!.gps).toEqual({ x: 27.493, y: -11.6642 });
    expect(row!.userAgent).toBe("vitest");
    expect(Math.abs(row!.createdAt.getTime() - before)).toBeLessThan(10_000);
    expect(row!.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("refuses UPDATE, DELETE and TRUNCATE for the runtime role", async () => {
    const db = appDb();
    for (const stmt of [
      sql`update app.audit_log set action = 'x' where id = -1`,
      sql`delete from app.audit_log where id = -1`,
      sql`truncate app.audit_log`,
    ]) {
      let code: string | undefined;
      try {
        await db.execute(stmt);
      } catch (err) {
        code = pgCode(err);
      }
      expect(code, String(stmt.queryChunks[0])).toBe("42501"); // insufficient_privilege
    }
  });

  it("refuses UPDATE and DELETE for the owner as well (trigger)", async () => {
    const db = ownerDb();
    const id = await writeAudit(db, {
      actor: { type: "system" },
      action: "test.owner_written",
      object: { type: "test", id: "t-owner" },
    });
    for (const stmt of [
      sql`update app.audit_log set action = 'x' where id = ${id}`,
      sql`delete from app.audit_log where id = ${id}`,
    ]) {
      let message = "";
      try {
        await db.execute(stmt);
      } catch (err) {
        message = pgMessage(err);
      }
      expect(message).toContain("append-only");
    }
  });
});
