import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  admins,
  auditLog,
  entities,
  exemptions,
  obligations,
  taxRules,
  taxpayers,
} from "@/lib/db/schema";
import type { AdminSession } from "@/lib/identity/session";
import { baremeFor } from "@/lib/invoices/bareme";
import {
  applicableRuleCodes,
  createManualObligation,
  loadCreateOptions,
} from "@/lib/invoices/create";
import { loadInvoiceSnapshot } from "@/lib/invoices/snapshot";
import { computePenalty, versionFor, type Rule } from "@/lib/tax-engine";
import { loadRules } from "@/lib/census/register";
import { runSeed } from "@/scripts/seed";

import { appDb } from "./db";

/** A random far-future year: the run is repeatable on a shared database; rows are removed after. */
const YEAR = 2100 + Math.floor(Math.random() * 800);
const created: string[] = [];
const CTX = { ip: "41.243.0.10", userAgent: "vitest" };
const NOW = new Date("2026-09-29T10:00:00+02:00");
const TAXPAYER = "LUB-KAM-00000127";

let maire: AdminSession;
let auditeur: AdminSession;
let entityId: string;
/** LUB-KAM-00000128 (Restaurant Chez Sarah): a Commerce entity without overrides, for `patente`. */
let commerceEntityId: string;
/** LUB-KAM-00000126 (étal 41): Commerce with `etalage` included and `patente` excluded by override. */
let etalEntityId: string;
let menage: Rule;
/** Exemption rows inserted by this file, removed after it. */
const exemptionIds: string[] = [];
/** What assainissement_menage charges in YEAR: other suites approve versions at far-future dates. */
let BAREME: number;

const sessionFor = async (email: string): Promise<AdminSession> => {
  const [row] = await appDb().select().from(admins).where(eq(admins.email, email));
  if (!row) throw new Error(`no admin ${email}`);
  return {
    adminId: row.id,
    authUserId: row.authUserId ?? "00000000-0000-0000-0000-000000000000",
    email: row.email,
    fullName: row.fullName,
    role: row.role,
  };
};

const month = (m: number) => `${YEAR}-${String(m).padStart(2, "0")}-01`;

function input(m: number, over: Record<string, unknown> = {}) {
  return {
    taxpayerNo: TAXPAYER,
    entityId,
    taxRuleCode: "assainissement_menage",
    periodStart: month(m),
    dueDate: `${YEAR}-${String(m).padStart(2, "0")}-28`,
    ...over,
  };
}

async function auditRows(action: string, invoiceNo: string) {
  return appDb()
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, action),
        eq(auditLog.objectType, "obligation"),
        eq(auditLog.objectId, invoiceNo),
      ),
    )
    .orderBy(asc(auditLog.id));
}

async function countOf() {
  const rows = await appDb()
    .select({ id: obligations.id })
    .from(obligations)
    .where(eq(obligations.entityId, entityId));
  return rows.length;
}

// Runs once after every test of the file: whatever any test created is removed.
afterAll(async () => {
  if (created.length) await appDb().delete(obligations).where(inArray(obligations.id, created));
  if (exemptionIds.length) {
    await appDb().delete(exemptions).where(inArray(exemptions.id, exemptionIds));
  }
});

/** The entity of a seeded taxpayer (each has exactly one). */
async function entityOf(taxpayerNo: string): Promise<typeof entities.$inferSelect> {
  const db = appDb();
  const [tp] = await db
    .select({ id: taxpayers.id })
    .from(taxpayers)
    .where(eq(taxpayers.taxpayerNo, taxpayerNo));
  const [ent] = await db.select().from(entities).where(eq(entities.taxpayerId, tp!.id));
  return ent!;
}

describe("ad-hoc note de perception created from the back office (D35)", () => {
  beforeAll(async () => {
    const db = appDb();
    await runSeed(db);
    [maire, auditeur] = await Promise.all([
      sessionFor("maire@lubumbashi.cd"),
      sessionFor("auditeur@lubumbashi.cd"),
    ]);
    const [tp] = await db
      .select({ id: taxpayers.id })
      .from(taxpayers)
      .where(eq(taxpayers.taxpayerNo, TAXPAYER));
    const [ent] = await db.select().from(entities).where(eq(entities.taxpayerId, tp!.id));
    entityId = ent!.id;
    commerceEntityId = (await entityOf("LUB-KAM-00000128")).id;
    etalEntityId = (await entityOf("LUB-KAM-00000126")).id;
    menage = (await loadRules(db)).find((r) => r.code === "assainissement_menage")!;
    BAREME = baremeFor(menage, ent!.taxBaseFc, month(3)).amountFc!;
    expect(BAREME).toBeGreaterThan(0);
  }, 120_000);

  it("the Maire creates a note at the barème: obligation due, version in force, AV number, issued at once in her name, two audit rows", async () => {
    const db = appDb();
    const rule = menage;
    const inForce = versionFor(rule, month(3))!;
    expect(inForce.amountFc).toBe(BAREME);

    const r = await createManualObligation(db, maire, input(3, { label: "Objet test" }), CTX, NOW);
    created.push(r.obligationId);
    expect(r.invoiceNo).toMatch(/^AV-\d{4}-\d{6}$/);
    expect(r).toMatchObject({
      amountFc: BAREME,
      baremeAmountFc: BAREME,
      versionId: inForce.id,
      periodStart: month(3),
      periodEnd: `${YEAR}-03-31`,
      dueDate: `${YEAR}-03-28`,
    });

    const [o] = await db.select().from(obligations).where(eq(obligations.id, r.obligationId));
    expect(o).toMatchObject({
      entityId,
      taxRuleId: rule.id,
      taxRuleVersionId: inForce.id,
      periodStart: month(3),
      periodEnd: `${YEAR}-03-31`,
      dueDate: `${YEAR}-03-28`,
      amountFc: BAREME,
      penaltyFc: 0,
      paidFc: 0,
      status: "due",
      invoiceNo: r.invoiceNo,
      invoiceIssuedByAdminId: maire.adminId,
    });
    expect(o!.invoiceIssuedAt?.toISOString()).toBe(NOW.toISOString());
    const [tp] = await db
      .select({ id: taxpayers.id })
      .from(taxpayers)
      .where(eq(taxpayers.taxpayerNo, TAXPAYER));
    expect(o!.taxpayerId).toBe(tp!.id);

    const createdRows = await auditRows("obligation.created", r.invoiceNo);
    expect(createdRows).toHaveLength(1);
    expect(createdRows[0]).toMatchObject({
      actorType: "admin",
      actorId: maire.adminId,
      actorRole: "maire",
      actorLabel: maire.email,
      ip: "41.243.0.10",
      userAgent: "vitest",
    });
    expect(createdRows[0]!.details).toMatchObject({
      obligationId: r.obligationId,
      taxpayerNo: TAXPAYER,
      entityId,
      taxRuleCode: "assainissement_menage",
      versionId: inForce.id,
      periodStart: month(3),
      periodEnd: `${YEAR}-03-31`,
      dueDate: `${YEAR}-03-28`,
      amountFc: BAREME,
      baremeAmountFc: BAREME,
      manualAmount: false,
      penaltyAtIssueFc: 0,
      reason: null,
      label: "Objet test",
      source: "back_office",
    });
    const issuedRows = await auditRows("invoice.issued", r.invoiceNo);
    expect(issuedRows).toHaveLength(1);
    expect(issuedRows[0]).toMatchObject({
      actorId: maire.adminId,
      actorLabel: maire.email,
      ip: "41.243.0.10",
      userAgent: "vitest",
    });
    expect(issuedRows[0]!.id).toBeGreaterThan(createdRows[0]!.id);

    // The note reads as issued by her, and carries the « Objet » on every print.
    const snapshot = await loadInvoiceSnapshot(db, { invoiceNo: r.invoiceNo }, NOW);
    expect(snapshot).toMatchObject({
      issuedAt: NOW.toISOString(),
      issuedBy: maire.fullName,
      issuedBySystem: false,
      label: "Objet test",
      amountFc: BAREME,
      outstandingFc: BAREME,
      taxpayer: { taxpayerNo: TAXPAYER },
    });
  });

  it("a manual amount needs a reason; with one, the amount is stored and the journal keeps the barème", async () => {
    const db = appDb();
    const before = await countOf();
    await expect(
      createManualObligation(db, maire, input(4, { amountFc: 3000 }), CTX, NOW),
    ).rejects.toMatchObject({ code: "invalid_input", detail: "reason_required" });
    await expect(
      createManualObligation(db, maire, input(4, { amountFc: 3000, reason: "abc" }), CTX, NOW),
    ).rejects.toMatchObject({ code: "invalid_input", detail: "reason_required" });
    expect(await countOf()).toBe(before);

    const r = await createManualObligation(
      db,
      maire,
      input(4, { amountFc: 3000, reason: "Remise exceptionnelle du Maire" }),
      CTX,
      NOW,
    );
    created.push(r.obligationId);
    expect(r).toMatchObject({ amountFc: 3000, baremeAmountFc: BAREME });
    const [o] = await db.select().from(obligations).where(eq(obligations.id, r.obligationId));
    expect(o).toMatchObject({
      amountFc: 3000,
      status: "due",
      invoiceIssuedByAdminId: maire.adminId,
    });
    const [row] = await auditRows("obligation.created", r.invoiceNo);
    expect(row!.details).toMatchObject({
      amountFc: 3000,
      baremeAmountFc: BAREME,
      manualAmount: true,
      reason: "Remise exceptionnelle du Maire",
      label: null,
    });
    // The barème itself needs no reason, and an explicit barème amount is not "manual".
    const same = await createManualObligation(db, maire, input(5, { amountFc: BAREME }), CTX, NOW);
    created.push(same.obligationId);
    const [sameRow] = await auditRows("obligation.created", same.invoiceNo);
    expect(sameRow!.details).toMatchObject({ manualAmount: false, amountFc: BAREME });
    expect((await loadInvoiceSnapshot(db, { invoiceNo: same.invoiceNo }))?.label).toBeNull();
  });

  it("the same (entity, rule, period) twice is refused with the existing note's number; nothing else is written", async () => {
    const db = appDb();
    const first = await createManualObligation(db, maire, input(6), CTX, NOW);
    created.push(first.obligationId);
    const before = await countOf();
    const auditBefore = (await auditRows("obligation.created", first.invoiceNo)).length;
    await expect(
      createManualObligation(db, maire, input(6, { dueDate: `${YEAR}-06-30` }), CTX, NOW),
    ).rejects.toMatchObject({ code: "duplicate_period", detail: first.invoiceNo });
    expect(await countOf()).toBe(before);
    expect(await auditRows("obligation.created", first.invoiceNo)).toHaveLength(auditBefore);
  });

  it("the Auditeur is refused before anything is read; unknown rule, foreign entity, bad due date and a period without an approved version are refused", async () => {
    const db = appDb();
    const before = await countOf();
    await expect(createManualObligation(db, auditeur, input(7), CTX, NOW)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      createManualObligation(db, maire, input(7, { taxRuleCode: "taxe_inconnue" }), CTX, NOW),
    ).rejects.toMatchObject({ code: "not_found", detail: "taxe_inconnue" });
    // An entity of another taxpayer is not this taxpayer's.
    const [tp125] = await db
      .select({ id: taxpayers.id })
      .from(taxpayers)
      .where(eq(taxpayers.taxpayerNo, "LUB-KAM-00000125"));
    const [other] = await db.select().from(entities).where(eq(entities.taxpayerId, tp125!.id));
    await expect(
      createManualObligation(db, maire, input(7, { entityId: other!.id }), CTX, NOW),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      createManualObligation(db, maire, input(7, { dueDate: `${YEAR}-06-30` }), CTX, NOW),
    ).rejects.toMatchObject({ code: "invalid_input", detail: "due_date" });
    await expect(
      createManualObligation(db, maire, input(7, { periodStart: `${YEAR}-07-15` }), CTX, NOW),
    ).rejects.toThrow();
    // assainissement_menage has no version before 2026-06-01.
    await expect(
      createManualObligation(
        db,
        maire,
        input(7, { periodStart: "2025-01-01", dueDate: "2025-01-31" }),
        CTX,
        NOW,
      ),
    ).rejects.toMatchObject({ code: "invalid_state", detail: "no_version" });
    expect(await countOf()).toBe(before);
  });

  it("an annual rule widens the month to its year; the form options carry the active rules with their versions, and baremeFor derives what the server charges", async () => {
    const db = appDb();
    const [patente] = await db.select().from(taxRules).where(eq(taxRules.code, "patente"));
    expect(patente).toBeDefined();
    // `patente` is a Commerce rule: the note goes to a Commerce entity (LUB-KAM-00000128).
    const commerce = { taxpayerNo: "LUB-KAM-00000128", entityId: commerceEntityId };
    const r = await createManualObligation(
      db,
      maire,
      input(8, { ...commerce, taxRuleCode: "patente", dueDate: `${YEAR}-12-31` }),
      CTX,
      NOW,
    );
    created.push(r.obligationId);
    const patenteRule = (await loadRules(db)).find((x) => x.code === "patente")!;
    expect(r).toMatchObject({
      periodStart: `${YEAR}-01-01`,
      periodEnd: `${YEAR}-12-31`,
      amountFc: versionFor(patenteRule, `${YEAR}-01-01`)!.amountFc,
    });
    // Another month of the same year is the same period: duplicate.
    await expect(
      createManualObligation(
        db,
        maire,
        input(2, { ...commerce, taxRuleCode: "patente", dueDate: `${YEAR}-12-31` }),
        CTX,
        NOW,
      ),
    ).rejects.toMatchObject({ code: "duplicate_period", detail: r.invoiceNo });

    const [ent] = await db.select().from(entities).where(eq(entities.id, entityId));
    const options = await loadCreateOptions(db, NOW);
    expect(options.month).toBe("2026-09");
    expect(options.rules.map((x) => x.code)).toEqual(
      expect.arrayContaining(["assainissement_menage", "patente"]),
    );
    expect(options.rules.every((x) => x.labelFr.length > 0 && x.categoryLabel.length > 0)).toBe(
      true,
    );
    // Only active rules, each with its versions (drafts included; versionFor skips them).
    expect(options.rules.every((x) => x.active && x.versions.length > 0)).toBe(true);
    const annual = options.rules.find((x) => x.code === "patente")!;
    expect(annual.frequency).toBe("annual");
    // The form and the server share one derivation: month → period, version in force, amount.
    const b = baremeFor(annual, ent!.taxBaseFc, month(8));
    expect(b).toMatchObject({
      period: { start: `${YEAR}-01-01`, end: `${YEAR}-12-31` },
      amountFc: r.amountFc,
      skipped: null,
      dueDate: `${YEAR}-12-31`,
    });
    expect(b.version?.id).toBe(r.versionId);
    const current = baremeFor(
      options.rules.find((x) => x.code === "assainissement_menage")!,
      ent!.taxBaseFc,
      "2026-09-01",
    );
    expect(current).toMatchObject({
      period: { start: "2026-09-01", end: "2026-09-30" },
      amountFc: 5000,
      skipped: null,
      dueDate: "2026-09-30",
    });
    // A percent rule without a base, or a date without an approved version, says why.
    const immobiliere = (await loadRules(db)).find((x) => x.code === "immobiliere")!;
    expect(baremeFor(immobiliere, null, "2027-01-01").skipped).toBe("no_version");
    expect(baremeFor(menage, null, "2025-01-01")).toMatchObject({
      version: null,
      amountFc: null,
      skipped: "no_version",
    });
  });

  it("a month before the entity's registration month is refused (D27: no back-dated note); nothing is inserted", async () => {
    const db = appDb();
    const before = await countOf();
    // LUB-KAM-00000127 was registered on 2026-09-03: August 2026 has an approved barème but
    // precedes the registration month; June 2026 likewise.
    for (const [periodStart, dueDate] of [
      ["2026-08-01", "2026-08-31"],
      ["2026-06-01", "2026-06-30"],
    ] as const) {
      await expect(
        createManualObligation(db, maire, input(1, { periodStart, dueDate }), CTX, NOW),
      ).rejects.toMatchObject({ code: "invalid_input", detail: "period_before_registration" });
    }
    expect(await countOf()).toBe(before);
    expect(
      await db
        .select({ id: obligations.id })
        .from(obligations)
        .where(and(eq(obligations.entityId, entityId), eq(obligations.periodStart, "2026-08-01"))),
    ).toHaveLength(0);
  });

  it("a rule that does not apply to the entity is refused: another category, or excluded by override; an included rule is accepted", async () => {
    const db = appDb();
    const before = await countOf();
    // Ménage entity, Commerce rule: 25 000 FC at "barème" with no reason would otherwise pass.
    await expect(
      createManualObligation(
        db,
        maire,
        input(1, { taxRuleCode: "assainissement_commerce" }),
        CTX,
        NOW,
      ),
    ).rejects.toMatchObject({ code: "invalid_input", detail: "rule_not_applicable" });
    await expect(
      createManualObligation(
        db,
        maire,
        input(1, { taxRuleCode: "patente", dueDate: `${YEAR}-12-31` }),
        CTX,
        NOW,
      ),
    ).rejects.toMatchObject({ code: "invalid_input", detail: "rule_not_applicable" });
    expect(await countOf()).toBe(before);

    // LUB-KAM-00000126: Commerce, `patente` excluded and `etalage` included by entity_rule_overrides.
    const etal = { taxpayerNo: "LUB-KAM-00000126", entityId: etalEntityId };
    await expect(
      createManualObligation(
        db,
        maire,
        input(1, { ...etal, taxRuleCode: "patente", dueDate: `${YEAR}-12-31` }),
        CTX,
        NOW,
      ),
    ).rejects.toMatchObject({ code: "invalid_input", detail: "rule_not_applicable" });
    const included = await createManualObligation(
      db,
      maire,
      input(1, { ...etal, taxRuleCode: "etalage" }),
      CTX,
      NOW,
    );
    created.push(included.obligationId);
    expect(included.invoiceNo).toMatch(/^AV-\d{4}-\d{6}$/);

    // The form offers exactly what the server accepts (category ± overrides).
    const rules = await loadRules(db);
    const codes = await applicableRuleCodes(
      db,
      [await entityOf(TAXPAYER), await entityOf("LUB-KAM-00000126")],
      rules,
    );
    expect(codes[entityId]).toEqual(["assainissement_menage"]);
    expect(codes[etalEntityId]!.sort()).toEqual(["assainissement_commerce", "etalage"]);
    expect(await applicableRuleCodes(db, [], rules)).toEqual({});
  });

  it("an exemption of the taxpayer in force at the period makes the rule not applicable; outside its validity the note is created", async () => {
    const db = appDb();
    const [tp] = await db
      .select({ id: taxpayers.id })
      .from(taxpayers)
      .where(eq(taxpayers.taxpayerNo, TAXPAYER));
    const [ex] = await db
      .insert(exemptions)
      .values({
        taxpayerId: tp!.id,
        taxRuleId: menage.id,
        reason: "Exonération test (vitest)",
        validFrom: month(9),
        validTo: `${YEAR}-09-30`,
        grantedByAdminId: maire.adminId,
      })
      .returning({ id: exemptions.id });
    exemptionIds.push(ex!.id);
    const before = await countOf();
    await expect(createManualObligation(db, maire, input(9), CTX, NOW)).rejects.toMatchObject({
      code: "invalid_input",
      detail: "rule_not_applicable",
    });
    expect(await countOf()).toBe(before);
    const after = await createManualObligation(db, maire, input(11), CTX, NOW);
    created.push(after.obligationId);
    expect(after.periodStart).toBe(month(11));
  });

  it("a missed past period at or after registration is created, and the journal carries the penalty the note is born with", async () => {
    const db = appDb();
    // Every month from registration to today is already billed for the seeded entities, so the
    // "past" is made with the clock: the note for October YEAR is issued on 15 December YEAR,
    // 45 days after its due date, beyond the 30-day grace of assainissement_menage.
    const dueDate = `${YEAR}-10-31`;
    const later = new Date(`${YEAR}-12-15T10:00:00+02:00`);
    const inForce = versionFor(menage, month(10))!;
    const expectedPenalty = computePenalty(inForce, { dueDate, amountFc: BAREME }, `${YEAR}-12-15`);
    expect(expectedPenalty).toBeGreaterThan(0);

    const r = await createManualObligation(db, maire, input(10, { dueDate }), CTX, later);
    created.push(r.obligationId);
    expect(r).toMatchObject({ amountFc: BAREME, dueDate, periodStart: month(10) });
    const [o] = await db.select().from(obligations).where(eq(obligations.id, r.obligationId));
    // Stored penalty stays 0 (the accrual job writes it); the print computes it as of its day.
    expect(o).toMatchObject({ penaltyFc: 0, status: "due", amountFc: BAREME });
    const [row] = await auditRows("obligation.created", r.invoiceNo);
    expect(row!.details).toMatchObject({
      amountFc: BAREME,
      dueDate,
      penaltyAtIssueFc: expectedPenalty,
      manualAmount: false,
    });
    const snapshot = await loadInvoiceSnapshot(db, { invoiceNo: r.invoiceNo }, later);
    expect(snapshot).toMatchObject({
      penaltyFc: expectedPenalty,
      outstandingFc: BAREME + expectedPenalty,
    });
    // Issued within the grace period: no penalty yet, and the journal says so.
    const soon = await createManualObligation(
      db,
      maire,
      input(12, { dueDate: `${YEAR}-12-28` }),
      CTX,
      new Date(`${YEAR + 1}-01-05T10:00:00+02:00`),
    );
    created.push(soon.obligationId);
    const [soonRow] = await auditRows("obligation.created", soon.invoiceNo);
    expect(soonRow!.details).toMatchObject({ penaltyAtIssueFc: 0 });
  });
});
