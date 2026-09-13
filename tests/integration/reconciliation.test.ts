import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  admins,
  agents,
  auditLog,
  dailyCloses,
  devices,
  obligations,
  payments,
  receipts,
  reconciliationExceptions,
  taxpayers,
} from "@/lib/db/schema";
import type { AdminSession } from "@/lib/identity/session";
import { accruePenalties } from "@/lib/jobs/penalties";
import { applyProviderResult, initiatePayment, type PaymentActor } from "@/lib/payments/service";
import {
  attachToTaxpayer,
  closeDay,
  requestReversal,
  requeryProvider,
  resolveManually,
} from "@/lib/reconciliation/actions";
import { openExceptionCount, runReconciliation } from "@/lib/reconciliation/run";
import { reconciliationDay } from "@/lib/reconciliation/view";
import { runSeed } from "@/scripts/seed";

import { appDb } from "./db";

/** A far-future business day of its own, so runs never collide with the demo data or earlier runs. */
const YEAR = 2100 + Math.floor(Math.random() * 800);
const DAY = `${YEAR}-06-15`;
const at = (hh: string) => new Date(`${DAY}T${hh}:00+02:00`);
let finances: AdminSession;
let auditeur: AdminSession;
let actor: PaymentActor;
let taxpayer: typeof taxpayers.$inferSelect;
let template: typeof obligations.$inferSelect;

async function confirmedPayment(amountFc: number, hh: string, month: string) {
  const db = appDb();
  const [o] = await db
    .insert(obligations)
    .values({
      entityId: template.entityId,
      taxpayerId: taxpayer.id,
      taxRuleId: template.taxRuleId,
      taxRuleVersionId: template.taxRuleVersionId,
      periodStart: `${YEAR}-${month}-01`,
      periodEnd: `${YEAR}-${month}-28`,
      dueDate: `${YEAR}-${month}-28`,
      amountFc,
    })
    .returning();
  const view = await initiatePayment(
    db,
    actor,
    { taxpayerNo: taxpayer.taxpayerNo, channel: "mpesa", obligationIds: [o!.id] },
    at(hh),
  );
  await applyProviderResult(
    db,
    view.reference,
    { status: "confirmed", providerReference: `MP-${view.reference}`, amountFc, raw: {} },
    "callback",
    at(hh),
  );
  return view.reference;
}

describe("reconciliation (M9): mock statement, exceptions, resolutions, daily close", () => {
  beforeAll(async () => {
    const db = appDb();
    await runSeed(db);
    const adminRow = async (email: string) =>
      (await db.select().from(admins).where(eq(admins.email, email)))[0]!;
    const f = await adminRow("ngoy.k@lubumbashi.cd");
    const a = await adminRow("auditeur@lubumbashi.cd");
    finances = {
      adminId: f.id,
      email: f.email,
      fullName: f.fullName,
      role: f.role,
    } as AdminSession;
    auditeur = {
      adminId: a.id,
      email: a.email,
      fullName: a.fullName,
      role: a.role,
    } as AdminSession;
    const [agent] = await db.select().from(agents).where(eq(agents.matricule, "AG-KAM-007"));
    const [device] = await db.select().from(devices).where(eq(devices.deviceCode, "DEV-3F9A"));
    actor = {
      type: "agent",
      agentId: agent!.id,
      matricule: agent!.matricule,
      deviceId: device!.id,
    };
    taxpayer = (
      await db.select().from(taxpayers).where(eq(taxpayers.taxpayerNo, "LUB-KAM-00000129"))
    )[0]!;
    template = (
      await db.select().from(obligations).where(eq(obligations.taxpayerId, taxpayer.id)).limit(1)
    )[0]!;
  });

  it("three confirmed payments give exactly the three demo exceptions; a re-run keeps resolutions", async () => {
    const db = appDb();
    const refs = [
      await confirmedPayment(3000, "09:00", "01"),
      await confirmedPayment(4000, "11:00", "02"),
      await confirmedPayment(6000, "14:00", "03"),
    ];
    const run = await runReconciliation(db, DAY, "mpesa", { now: at("23:30") });
    expect(run.status).toBe("completed");
    expect(run.platformCount).toBe(3);
    expect(run.platformTotalFc).toBe(13000);
    expect(run.statementCount).toBe(4); // 2 kept + 1 duplicate + 1 unknown
    expect(run.matchedCount).toBe(2);
    expect(run.exceptionCount).toBe(3);

    const view = await reconciliationDay(db, DAY, ["mpesa"]);
    const types = view.exceptions.map((e) => e.type).sort();
    expect(types).toEqual(["duplicate_at_provider", "missing_at_provider", "missing_on_platform"]);
    expect(view.exceptions.find((e) => e.type === "missing_at_provider")?.platformReference).toBe(
      refs[2],
    );
    expect(view.exceptions.find((e) => e.type === "duplicate_at_provider")?.platformReference).toBe(
      refs[1],
    );

    // Auditeur is read-only.
    const missing = view.exceptions.find((e) => e.type === "missing_at_provider")!;
    await expect(requeryProvider(db, auditeur, { exceptionId: missing.id })).rejects.toThrow(
      /forbidden/,
    );
    // The day cannot close with open exceptions.
    await expect(
      closeDay(db, finances, { businessDate: DAY }, {}, at("23:40"), ["mpesa"]),
    ).rejects.toThrow(/open_exceptions/);

    // 1. Absent du relevé → re-query: the mock confirms with the same reference → resolved.
    const rq = await requeryProvider(
      db,
      finances,
      { exceptionId: missing.id },
      { ip: "10.0.0.9" },
      { now: at("23:41") },
    );
    expect(rq.resolved).toBe(true);
    // 2. Doublon → reversal requested at the provider.
    const dup = view.exceptions.find((e) => e.type === "duplicate_at_provider")!;
    const rv = await requestReversal(
      db,
      finances,
      { exceptionId: dup.id, reason: "Débit en double confirmé par le client" },
      {},
      { now: at("23:42") },
    );
    expect(rv.providerReference).toMatch(/-DUP-REV$/);
    // 3. Hors plateforme → attach to a taxpayer: a confirmed payment with a receipt appears.
    const unknown = view.exceptions.find((e) => e.type === "missing_on_platform")!;
    const att = await attachToTaxpayer(
      db,
      finances,
      { exceptionId: unknown.id, taxpayerNo: "LUB-KAM-00000127" },
      {},
      at("23:43"),
    );
    expect(att.receiptNo).toMatch(/^RCP-/);
    const [attached] = await db
      .select()
      .from(payments)
      .where(eq(payments.reference, att.reference));
    expect(attached).toMatchObject({
      status: "confirmed",
      origin: "counter",
      channel: "mpesa",
      amountFc: 5000,
    });
    const [receipt] = await db.select().from(receipts).where(eq(receipts.paymentId, attached!.id));
    expect(receipt).toBeTruthy();

    expect(await openExceptionCount(db, DAY)).toBe(0);
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "reconciliation_exception.resolved"),
          eq(auditLog.objectId, missing.id),
        ),
      );
    expect(audits[0]!.ip).toBe("10.0.0.9");

    // Re-run: the same perturbation, but nothing resolved reopens.
    const again = await runReconciliation(db, DAY, "mpesa", { now: at("23:45") });
    expect(again.newExceptions).toBe(0);
    expect(again.exceptionCount).toBe(0);
    const stillResolved = await db
      .select()
      .from(reconciliationExceptions)
      .where(eq(reconciliationExceptions.runId, again.runId));
    expect(stillResolved.every((e) => e.status === "resolved")).toBe(true);

    // Close the day (mpesa only in this test), twice is refused.
    const closed = await closeDay(
      db,
      finances,
      { businessDate: DAY, note: "test" },
      {},
      at("23:50"),
      ["mpesa"],
    );
    expect(closed.transactionCount).toBeGreaterThanOrEqual(4);
    const [row] = await db.select().from(dailyCloses).where(eq(dailyCloses.businessDate, DAY));
    expect(row!.closedByAdminId).toBe(finances.adminId);
    await expect(
      closeDay(db, finances, { businessDate: DAY }, {}, at("23:51"), ["mpesa"]),
    ).rejects.toThrow(/already_closed/);
    await expect(
      closeDay(
        db,
        finances,
        { businessDate: `${YEAR}-06-16` },
        {},
        new Date(`${YEAR}-06-17T10:00:00+02:00`),
        ["airtel"],
      ),
    ).rejects.toThrow(/missing_statement/);
  });

  it("manual resolution needs a real text; resolved exceptions cannot be touched again", async () => {
    const db = appDb();
    const view = await reconciliationDay(db, DAY, ["mpesa"]);
    const any = view.exceptions[0]!;
    await expect(
      resolveManually(db, finances, { exceptionId: any.id, resolution: "ok" }),
    ).rejects.toThrow();
    await expect(
      resolveManually(db, finances, { exceptionId: any.id, resolution: "Remboursé au guichet" }),
    ).rejects.toThrow(/invalid_state/);
  });

  it("penalty accrual writes the engine's penalty on late obligations and audits once", async () => {
    const db = appDb();
    const [late] = await db
      .insert(obligations)
      .values({
        entityId: template.entityId,
        taxpayerId: taxpayer.id,
        taxRuleId: template.taxRuleId,
        taxRuleVersionId: template.taxRuleVersionId,
        periodStart: `${YEAR}-09-01`,
        periodEnd: `${YEAR}-09-30`,
        dueDate: `${YEAR}-09-30`,
        amountFc: 5000,
      })
      .returning();
    const asOf = new Date(`${YEAR}-12-31T12:00:00+02:00`);
    const r = await accruePenalties(db, asOf, [taxpayer.id]);
    expect(r.asOf).toBe(`${YEAR}-12-31`);
    expect(r.updated).toBeGreaterThan(0);
    const [after] = await db.select().from(obligations).where(eq(obligations.id, late!.id));
    expect(after!.penaltyFc).toBe(500); // 10 % once, after the 30-day grace period
    const second = await accruePenalties(db, asOf, [taxpayer.id]);
    expect(second.updated).toBe(0);
    await db
      .update(obligations)
      .set({ status: "cancelled", cancelledReason: "test" })
      .where(eq(obligations.id, late!.id));
  });
});
