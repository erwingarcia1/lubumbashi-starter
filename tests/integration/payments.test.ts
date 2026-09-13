import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  agents,
  auditLog,
  devices,
  notifications,
  obligations,
  paymentAllocations,
  payments,
  providerConfirmations,
  receipts,
  taxpayers,
} from "@/lib/db/schema";
import {
  applyProviderResult,
  getPaymentView,
  initiatePayment,
  PaymentError,
  syncPaymentStatus,
  type PaymentActor,
} from "@/lib/payments/service";
import { runSeed } from "@/scripts/seed";

import { appDb } from "./db";

/** Confirmations are append-only, so every run works on fresh obligations in a random far-future year. */
const YEAR = 2100 + Math.floor(Math.random() * 800);
const month = (m: number) => `${YEAR}-${String(m).padStart(2, "0")}`;
let actor: PaymentActor;
let taxpayerId: string;
let template: typeof obligations.$inferSelect;

async function freshObligation(m: number, amountFc: number, penaltyFc = 0) {
  const [row] = await appDb()
    .insert(obligations)
    .values({
      entityId: template.entityId,
      taxpayerId,
      taxRuleId: template.taxRuleId,
      taxRuleVersionId: template.taxRuleVersionId,
      periodStart: `${month(m)}-01`,
      periodEnd: `${month(m)}-28`,
      dueDate: `${month(m)}-28`,
      amountFc,
      penaltyFc,
    })
    .returning();
  return row!;
}

describe("payments: initiate → provider → confirmed → receipt (invariants 1, 2, 5, 7)", () => {
  beforeAll(async () => {
    const db = appDb();
    await runSeed(db);
    const [agent] = await db.select().from(agents).where(eq(agents.matricule, "AG-KAM-007"));
    const [device] = await db.select().from(devices).where(eq(devices.deviceCode, "DEV-3F9A"));
    actor = {
      type: "agent",
      agentId: agent!.id,
      matricule: agent!.matricule,
      deviceId: device!.id,
      gps: { lng: 27.49, lat: -11.66 },
    };
    const [tp] = await db
      .select()
      .from(taxpayers)
      .where(eq(taxpayers.taxpayerNo, "LUB-KAM-00000127"));
    taxpayerId = tp!.id;
    const [first] = await db
      .select()
      .from(obligations)
      .where(eq(obligations.taxpayerId, taxpayerId))
      .limit(1);
    template = first!;
  }, 120_000);

  it("derives the amount server-side, references before the provider, confirms after 3 s with allocation, receipt and SMS; replays are no-ops", async () => {
    const db = appDb();
    const a = await freshObligation(1, 5000);
    const b = await freshObligation(2, 5000, 500);
    const ids = [a.id, b.id];
    const t0 = new Date();
    const view = await initiatePayment(
      db,
      actor,
      { taxpayerNo: "LUB-KAM-00000127", channel: "mpesa", obligationIds: ids },
      t0,
    );
    expect(view.reference).toMatch(/^TX-\d{4}-\d{2}-\d{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(view.status).toBe("pending");
    expect(view.amountFc).toBe(10500);
    const audits = await db.select().from(auditLog).where(eq(auditLog.objectId, view.reference));
    expect(audits.map((x) => x.action).sort()).toEqual(["payment.initiated", "payment.pending"]);
    expect(audits.find((x) => x.action === "payment.initiated")?.deviceId).toBe(
      actor.type === "agent" ? actor.deviceId : null,
    );

    expect(
      (await syncPaymentStatus(db, view.reference, new Date(t0.getTime() + 1000)))?.status,
    ).toBe("pending");
    const done = await syncPaymentStatus(db, view.reference, new Date(t0.getTime() + 3500));
    expect(done?.status).toBe("confirmed");
    expect(done?.receiptNo).toMatch(/^RCP-\d{4}-\d{6}$/);
    expect(done?.providerReference).toMatch(/^MK\d{6}/);
    const [p] = await db.select().from(payments).where(eq(payments.reference, view.reference));
    const confs = await db
      .select()
      .from(providerConfirmations)
      .where(eq(providerConfirmations.paymentId, p!.id));
    expect(confs).toHaveLength(1);
    expect(confs[0]?.provider).toBe("mock");
    const allocs = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, p!.id));
    expect(allocs.reduce((s, x) => s + x.amountFc, 0)).toBe(10500);
    expect(allocs.map((x) => x.kind).sort()).toEqual(["penalty", "principal", "principal"]);
    const after = await db.select().from(obligations).where(inArray(obligations.id, ids));
    expect(after.every((o) => o.status === "paid")).toBe(true);
    const [receipt] = await db.select().from(receipts).where(eq(receipts.paymentId, p!.id));
    expect(receipt?.snapshot).toMatchObject({
      taxpayerNo: "LUB-KAM-00000127",
      amountFc: 10500,
      agentMatricule: "AG-KAM-007",
    });
    const sms = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.taxpayerId, taxpayerId), eq(notifications.kind, "receipt")));
    expect(sms.length).toBeGreaterThan(0);

    const replay = await applyProviderResult(
      db,
      view.reference,
      {
        status: "confirmed",
        providerReference: done!.providerReference!,
        amountFc: 10500,
        raw: {},
      },
      "callback",
    );
    expect(replay).toEqual({ applied: false, status: "confirmed", late: false });
    expect(
      await db
        .select()
        .from(providerConfirmations)
        .where(eq(providerConfirmations.paymentId, p!.id)),
    ).toHaveLength(1);
    expect(await db.select().from(receipts).where(eq(receipts.paymentId, p!.id))).toHaveLength(1);
    await expect(
      applyProviderResult(
        db,
        view.reference,
        { status: "confirmed", providerReference: "OTHER-REF", amountFc: 10500, raw: {} },
        "callback",
      ),
    ).rejects.toMatchObject({ code: "invalid_transition" });
    await expect(
      initiatePayment(db, actor, {
        taxpayerNo: "LUB-KAM-00000127",
        channel: "mpesa",
        obligationIds: ids,
      }),
    ).rejects.toMatchObject({ code: "nothing_to_pay" });
  });

  it("fails amounts ending in 999, refuses failed → confirmed, expires then accepts a late confirmation, refuses amount mismatches", async () => {
    const db = appDb();
    const t0 = new Date();
    const o999 = await freshObligation(3, 4999);
    const failing = await initiatePayment(
      db,
      actor,
      { taxpayerNo: "LUB-KAM-00000127", channel: "orange", obligationIds: [o999.id] },
      t0,
    );
    const failed = await syncPaymentStatus(db, failing.reference, new Date(t0.getTime() + 100));
    expect(failed?.status).toBe("failed");
    expect(failed?.failureReason).toBe("Solde insuffisant");
    await expect(
      applyProviderResult(
        db,
        failing.reference,
        { status: "confirmed", providerReference: "LATE-1", amountFc: 4999, raw: {} },
        "callback",
      ),
    ).rejects.toMatchObject({ code: "invalid_transition" });
    expect(
      (
        await applyProviderResult(
          db,
          failing.reference,
          { status: "failed", failureReason: "again", raw: {} },
          "callback",
        )
      ).applied,
    ).toBe(false);
    expect(
      (await db.select().from(obligations).where(eq(obligations.id, o999.id)))[0]?.status,
    ).toBe("due");

    const o6000 = await freshObligation(4, 6000);
    const late = await initiatePayment(
      db,
      actor,
      { taxpayerNo: "LUB-KAM-00000127", channel: "airtel", obligationIds: [o6000.id] },
      t0,
    );
    // The mock would confirm after 3 s; force the expiry path by asking with a clock inside the 3 s window but past the expiry.
    await db
      .update(payments)
      .set({ expiresAt: new Date(t0.getTime() + 1000) })
      .where(eq(payments.reference, late.reference));
    const expired = await syncPaymentStatus(db, late.reference, new Date(t0.getTime() + 2000));
    expect(expired?.status).toBe("expired");
    const r = await applyProviderResult(
      db,
      late.reference,
      { status: "confirmed", providerReference: `LATE-${YEAR}`, amountFc: 6000, raw: {} },
      "callback",
    );
    expect(r).toEqual({ applied: true, status: "confirmed", late: true });
    const [lateAudit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.objectId, late.reference), eq(auditLog.action, "payment.confirmed")));
    expect(lateAudit?.details).toMatchObject({ late: true, source: "callback" });

    const o7 = await freshObligation(5, 7000);
    const mm = await initiatePayment(
      db,
      actor,
      { taxpayerNo: "LUB-KAM-00000127", channel: "mpesa", obligationIds: [o7.id] },
      t0,
    );
    await expect(
      applyProviderResult(
        db,
        mm.reference,
        { status: "confirmed", providerReference: "MM-1", amountFc: 1, raw: {} },
        "callback",
      ),
    ).rejects.toMatchObject({ code: "amount_mismatch" });
    await expect(
      applyProviderResult(
        db,
        "TX-0000-00-0000-ZZZZ",
        { status: "failed", failureReason: "x", raw: {} },
        "callback",
      ),
    ).rejects.toBeInstanceOf(PaymentError);
    expect(await getPaymentView(db, "TX-0000-00-0000-ZZZZ")).toBeNull();
    await db
      .update(obligations)
      .set({ status: "cancelled", cancelledReason: "test" })
      .where(eq(obligations.id, o7.id));
  });

  it("a taxpayer can initiate from the portal (origin portal, IP and user agent audited)", async () => {
    const db = appDb();
    const o = await freshObligation(6, 8000);
    const t0 = new Date();
    const view = await initiatePayment(
      db,
      {
        type: "taxpayer",
        taxpayerId,
        taxpayerNo: "LUB-KAM-00000127",
        ip: "41.243.9.9",
        userAgent: "vitest-portal",
      },
      { taxpayerNo: "LUB-KAM-00000127", channel: "orange", obligationIds: [o.id] },
      t0,
    );
    expect(view.amountFc).toBe(8000);
    const [p] = await db.select().from(payments).where(eq(payments.reference, view.reference));
    expect(p?.origin).toBe("portal");
    expect(p?.initiatedByAgentId).toBeNull();
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.objectId, view.reference), eq(auditLog.action, "payment.initiated")));
    expect(audit?.actorType).toBe("taxpayer");
    expect(audit?.ip).toBe("41.243.9.9");
    expect(audit?.userAgent).toBe("vitest-portal");
    const done = await syncPaymentStatus(db, view.reference, new Date(t0.getTime() + 4000));
    expect(done?.status).toBe("confirmed");
    expect((await db.select().from(obligations).where(eq(obligations.id, o.id)))[0]?.status).toBe(
      "paid",
    );
    await expect(
      initiatePayment(
        db,
        { type: "taxpayer", taxpayerId, taxpayerNo: "LUB-KAM-00000999" },
        { taxpayerNo: "LUB-KAM-00000999", channel: "mpesa" },
      ),
    ).rejects.toMatchObject({ code: "taxpayer_not_found" });
  });
});
