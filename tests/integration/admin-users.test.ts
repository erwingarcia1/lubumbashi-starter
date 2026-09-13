import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { collectionsReport } from "@/lib/admin/collections";
import {
  createAdminUser,
  listAdminUsers,
  setAdminActive,
  setAdminRole,
  temporaryPassword,
} from "@/lib/admin/users";
import { admins, auditLog } from "@/lib/db/schema";
import type { AdminSession } from "@/lib/identity/session";
import { supabaseAdmin } from "@/lib/identity/supabase-admin";
import { runSeed } from "@/scripts/seed";

import { appDb } from "./db";

let administrateur: AdminSession;
let finances: AdminSession;

describe("Mairie users (Réglages) and collections by period", () => {
  beforeAll(async () => {
    const db = appDb();
    await runSeed(db);
    const row = async (email: string) =>
      (await db.select().from(admins).where(eq(admins.email, email)))[0]!;
    const a = await row("admin@lubumbashi.cd");
    const f = await row("ngoy.k@lubumbashi.cd");
    administrateur = {
      adminId: a.id,
      email: a.email,
      fullName: a.fullName,
      role: a.role,
    } as AdminSession;
    finances = {
      adminId: f.id,
      email: f.email,
      fullName: f.fullName,
      role: f.role,
    } as AdminSession;
  });

  it("creates a login with a one-time password, changes the role, disables and re-enables", async () => {
    const db = appDb();
    const email = `test.user.${Date.now()}@lubumbashi.cd`;
    const created = await createAdminUser(
      db,
      administrateur,
      { email, fullName: "Utilisateur Test", role: "auditeur" },
      { ip: "10.0.0.4" },
    );
    expect(created.temporaryPassword.length).toBeGreaterThanOrEqual(14);
    const auth = supabaseAdmin();
    const { data } = await auth.auth.signInWithPassword({
      email,
      password: created.temporaryPassword,
    });
    expect(data.user?.email).toBe(email);
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "admin_user.created"))
      .orderBy(auditLog.id);
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit!.details)).not.toContain(created.temporaryPassword);

    await setAdminRole(db, administrateur, { adminId: created.id, role: "finances" });
    await setAdminActive(db, administrateur, { adminId: created.id, active: false });
    let users = await listAdminUsers(db);
    let me = users.find((u) => u.email === email)!;
    expect(me.role).toBe("finances");
    expect(me.active).toBe(false);
    const banned = await auth.auth.signInWithPassword({
      email,
      password: created.temporaryPassword,
    });
    expect(banned.error).toBeTruthy();
    await setAdminActive(db, administrateur, { adminId: created.id, active: true });
    users = await listAdminUsers(db);
    me = users.find((u) => u.email === email)!;
    expect(me.active).toBe(true);

    await expect(
      createAdminUser(db, finances, { email: "x@lubumbashi.cd", fullName: "X Y Z", role: "maire" }),
    ).rejects.toThrow(/forbidden/);
    await expect(
      setAdminActive(db, administrateur, { adminId: administrateur.adminId, active: false }),
    ).rejects.toThrow(/invalid_state/);
    await expect(
      createAdminUser(db, administrateur, { email, fullName: "Again", role: "maire" }),
    ).rejects.toThrow(/invalid_state/);
    expect(temporaryPassword()).toMatch(/^[A-Za-z2-9]{14}!$/);
  });

  it("collections by period sum to the same total for every grouping", async () => {
    const db = appDb();
    const totals = await Promise.all(
      (["day", "week", "month", "year"] as const).map(async (groupBy) => {
        const r = await collectionsReport(db, { from: "2026-07-01", to: "2026-09-30", groupBy });
        expect(r.groupBy).toBe(groupBy);
        return r.byPeriod.reduce((s, p) => s + p.amountFc, 0);
      }),
    );
    expect(new Set(totals).size).toBe(1);
    expect(totals[0]).toBeGreaterThan(0);
    const month = await collectionsReport(db, {
      from: "2026-07-01",
      to: "2026-09-30",
      groupBy: "month",
    });
    expect(month.byPeriod.every((p) => /^\d{4}-\d{2}-01$/.test(p.period))).toBe(true);
  });
});
