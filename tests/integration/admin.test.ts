import { and, desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { AdminError } from "@/lib/admin/errors";
import {
  approveRuleVersion,
  getRuleWithVersions,
  listRules,
  proposeRuleVersion,
} from "@/lib/admin/taxes";
import {
  changeEntityCategory,
  getTaxpayerDetail,
  listTaxpayers,
  updateTaxpayerContact,
} from "@/lib/admin/taxpayers";
import { admins, auditLog, entities, taxRuleVersions, taxpayers } from "@/lib/db/schema";
import type { AdminSession } from "@/lib/identity/session";
import { runSeed } from "@/scripts/seed";

import { appDb } from "./db";

let finances: AdminSession;
let finances2: AdminSession;
let superviseur: AdminSession;
let auditeur: AdminSession;

const sessionFor = async (email: string, role: AdminSession["role"]): Promise<AdminSession> => {
  const [row] = await appDb().select().from(admins).where(eq(admins.email, email));
  if (!row) throw new Error(`no admin ${email}`);
  return {
    adminId: row.id,
    authUserId: row.authUserId ?? "00000000-0000-0000-0000-000000000000",
    email: row.email,
    fullName: row.fullName,
    role,
  };
};

describe("admin core: tax rule versions and taxpayer edits", () => {
  /** The Playwright flow leaves versions behind; start from the seeded state (v1 only, open-ended). */
  async function resetMenageVersions() {
    const db = appDb();
    const rule = await getRuleWithVersions(db, "assainissement_menage");
    for (const v of rule!.versions) {
      if (v.version === 1)
        await db
          .update(taxRuleVersions)
          .set({ effectiveTo: null, status: "approved" })
          .where(eq(taxRuleVersions.id, v.id));
      else await db.delete(taxRuleVersions).where(eq(taxRuleVersions.id, v.id));
    }
  }

  beforeAll(async () => {
    await runSeed(appDb());
    await resetMenageVersions();
    finances = await sessionFor("ngoy.k@lubumbashi.cd", "finances");
    finances2 = await sessionFor("admin@lubumbashi.cd", "administrateur");
    superviseur = await sessionFor("ilunga.m@lubumbashi.cd", "superviseur");
    auditeur = await sessionFor("auditeur@lubumbashi.cd", "auditeur");
  }, 120_000);

  it("proposes a draft version without touching the active one, and audits it", async () => {
    const db = appDb();
    const before = await getRuleWithVersions(db, "assainissement_menage");
    const activeBefore = before!.versions.find((v) => v.status === "approved");
    const { versionId, version } = await proposeRuleVersion(
      db,
      finances,
      {
        ruleCode: "assainissement_menage",
        amountFc: 6000,
        effectiveFrom: "2099-01-01",
        penaltyRateBp: 1000,
        graceDays: 30,
      },
      { ip: "41.243.0.10", userAgent: "vitest" },
    );
    const after = await getRuleWithVersions(db, "assainissement_menage");
    const draft = after!.versions.find((v) => v.id === versionId)!;
    expect(draft.status).toBe("draft");
    expect(draft.amountFc).toBe(6000);
    expect(version).toBe(Math.max(...before!.versions.map((v) => v.version)) + 1);
    expect(after!.versions.find((v) => v.id === activeBefore!.id)).toEqual(activeBefore);
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "tax_rule_version.proposed"),
          eq(auditLog.objectId, `assainissement_menage#${version}`),
        ),
      )
      .orderBy(desc(auditLog.id));
    expect(audit?.actorId).toBe(finances.adminId);
    expect(audit?.ip).toBe("41.243.0.10");
    // Auditeur cannot propose; Finances cannot propose in the past.
    await expect(
      proposeRuleVersion(db, auditeur, {
        ruleCode: "assainissement_menage",
        amountFc: 1,
        effectiveFrom: "2099-02-01",
        penaltyRateBp: null,
        graceDays: 0,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      proposeRuleVersion(db, finances, {
        ruleCode: "assainissement_menage",
        amountFc: 1,
        effectiveFrom: "2020-01-01",
        penaltyRateBp: null,
        graceDays: 0,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("refuses self-approval, accepts another allowed role, ends the previous version (invariant 6 kept)", async () => {
    const db = appDb();
    const rule = await getRuleWithVersions(db, "assainissement_menage");
    const draft = rule!.versions.find(
      (v) => v.status === "draft" && v.effectiveFrom === "2099-01-01",
    )!;
    await expect(approveRuleVersion(db, finances, draft.id)).rejects.toBeInstanceOf(AdminError);
    await expect(approveRuleVersion(db, finances, draft.id)).rejects.toMatchObject({
      code: "self_approval",
    });
    await expect(approveRuleVersion(db, auditeur, draft.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await approveRuleVersion(db, finances2, draft.id, { ip: "41.243.0.11" });
    const after = await getRuleWithVersions(db, "assainissement_menage");
    const approved = after!.versions.find((v) => v.id === draft.id)!;
    expect(approved.status).toBe("approved");
    expect(approved.approvedByAdminId).toBe(finances2.adminId);
    const previous = after!.versions.find((v) => v.version === 1)!;
    expect(previous.effectiveTo).toBe("2099-01-01");
    expect(previous.status).toBe("superseded");
    const list = await listRules(db);
    const menage = list.find((r) => r.code === "assainissement_menage")!;
    expect(menage.current?.version).toBe(1); // still in force today
    expect(menage.upcoming?.id).toBe(draft.id);
    await expect(approveRuleVersion(db, finances2, draft.id)).rejects.toMatchObject({
      code: "invalid_state",
    });
    // clean up so the seed stays representative for the demo
    await db
      .update(taxRuleVersions)
      .set({ effectiveTo: null, status: "approved" })
      .where(eq(taxRuleVersions.id, previous.id));
    await db.delete(taxRuleVersions).where(eq(taxRuleVersions.id, draft.id));
  });

  it("lists taxpayers with balances and finds them by name, phone or id", async () => {
    const db = appDb();
    const all = await listTaxpayers(db, {}, new Date("2026-09-13T08:42:00+02:00"));
    expect(all.total).toBeGreaterThanOrEqual(6);
    const jean = all.items.find((i) => i.taxpayerNo === "LUB-KAM-00000125")!;
    expect(jean.balance.pill).toBe("late");
    expect(jean.balance.outstandingFc).toBe(10000);
    expect((await listTaxpayers(db, { q: "Mwamba" })).items.map((i) => i.taxpayerNo)).toEqual([
      "LUB-KAM-00000125",
    ]);
    expect((await listTaxpayers(db, { q: "8830" })).items.map((i) => i.taxpayerNo)).toEqual([
      "LUB-KAM-00000125",
    ]);
    expect((await listTaxpayers(db, { q: "00000127" })).items.map((i) => i.taxpayerNo)).toEqual([
      "LUB-KAM-00000127",
    ]);
    expect((await listTaxpayers(db, { communeCode: "KEN" })).total).toBe(0);
  });

  it("shows a taxpayer's obligations, payments and journal", async () => {
    const d = await getTaxpayerDetail(
      appDb(),
      "LUB-KAM-00000125",
      new Date("2026-09-13T08:42:00+02:00"),
    );
    expect(d).not.toBeNull();
    expect(d!.obligations.map((o) => [o.periodStart, o.status])).toEqual([
      ["2026-09-01", "due"],
      ["2026-08-01", "due"],
      ["2026-07-01", "paid"],
      ["2026-06-01", "paid"],
    ]);
    expect(d!.payments).toHaveLength(2);
    expect(d!.payments.every((p) => p.receiptNo && p.providerReference)).toBe(true);
    expect(d!.journal.some((j) => j.action === "taxpayer.registered")).toBe(true);
    expect(d!.balance.lateFc).toBe(5000);
  });

  it("edits contact fields and category with audit rows, only for allowed roles", async () => {
    const db = appDb();
    await expect(
      updateTaxpayerContact(db, finances, {
        taxpayerNo: "LUB-KAM-00000127",
        phone: "+243972045562",
        address: "Av. Lumumba 87",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await updateTaxpayerContact(
      db,
      superviseur,
      { taxpayerNo: "LUB-KAM-00000127", phone: "+243972045562", address: "Av. Lumumba 87 bis" },
      { ip: "41.243.0.12" },
    );
    const [tp] = await db
      .select()
      .from(taxpayers)
      .where(eq(taxpayers.taxpayerNo, "LUB-KAM-00000127"));
    expect(tp?.phone).toBe("+243972045562");
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "taxpayer.contact_updated"),
          eq(auditLog.objectId, "LUB-KAM-00000127"),
        ),
      )
      .orderBy(desc(auditLog.id));
    expect(audit?.details).toMatchObject({ after: { phone: "+243972045562" } });
    await updateTaxpayerContact(db, superviseur, {
      taxpayerNo: "LUB-KAM-00000127",
      phone: "+243972045561",
      address: "Av. Lumumba 87",
    });

    const [entity] = await db.select().from(entities).where(eq(entities.taxpayerId, tp!.id));
    await expect(
      changeEntityCategory(db, superviseur, {
        entityId: entity!.id,
        categoryCode: "menage",
        reason: "Même catégorie",
      }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    await changeEntityCategory(
      db,
      superviseur,
      { entityId: entity!.id, categoryCode: "commerce", reason: "Erreur de saisie au recensement" },
      { ip: "41.243.0.12" },
    );
    const [changed] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "entity.category_changed"), eq(auditLog.objectId, entity!.id)))
      .orderBy(desc(auditLog.id));
    expect(changed?.reason).toBe("Erreur de saisie au recensement");
    expect(changed?.details).toMatchObject({ from: "menage", to: "commerce" });
    await changeEntityCategory(db, superviseur, {
      entityId: entity!.id,
      categoryCode: "menage",
      reason: "Retour à la catégorie initiale (test)",
    });
  });
});
