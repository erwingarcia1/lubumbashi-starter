import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { requestPaymentReversal } from "@/lib/admin/payments";
import {
  admins,
  agents,
  auditLog,
  devices,
  obligations,
  paymentAllocations,
  payments,
  receipts,
  taxpayers,
} from "@/lib/db/schema";
import type { AdminSession } from "@/lib/identity/session";
import { applyProviderResult, initiatePayment, type PaymentActor } from "@/lib/payments/service";
import { runSeed } from "@/scripts/seed";

import { appDb } from "./db";

const YEAR = 2100 + Math.floor(Math.random() * 800);
let finances: AdminSession;
let auditeur: AdminSession;
let actor: PaymentActor;
let taxpayer: typeof taxpayers.$inferSelect;
let template: typeof obligations.$inferSelect;

describe("controlled reversal of a confirmed payment (plan §6, invariant 7)", () => {
  beforeAll(async () => {
    const db = appDb();
    await runSeed(db);
    const row = async (email: string) =>
      (await db.select().from(admins).where(eq(admins.email, email)))[0]!;
    const f = await row("ngoy.k@lubumbashi.cd");
    const a = await row("auditeur@lubumbashi.cd");
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
      await db.select().from(taxpayers).where(eq(taxpayers.taxpayerNo, "LUB-KAM-00000131"))
    )[0]!;
    template = (
      await db.select().from(obligations).where(eq(obligations.taxpayerId, taxpayer.id)).limit(1)
    )[0]!;
  });

  it("gives the money back: obligation due again, receipt cancelled with the reason, payment reversed, audited", async () => {
    const db = appDb();
    const [o] = await db
      .insert(obligations)
      .values({
        entityId: template.entityId,
        taxpayerId: taxpayer.id,
        taxRuleId: template.taxRuleId,
        taxRuleVersionId: template.taxRuleVersionId,
        periodStart: `${YEAR}-02-01`,
        periodEnd: `${YEAR}-02-28`,
        dueDate: `${YEAR}-02-28`,
        amountFc: 8000,
      })
      .returning();
    const view = await initiatePayment(db, actor, {
      taxpayerNo: taxpayer.taxpayerNo,
      channel: "mpesa",
      obligationIds: [o!.id],
    });
    await applyProviderResult(
      db,
      view.reference,
      { status: "confirmed", providerReference: `REV-${view.reference}`, amountFc: 8000, raw: {} },
      "callback",
    );
    expect((await db.select().from(obligations).where(eq(obligations.id, o!.id)))[0]!.status).toBe(
      "paid",
    );

    await expect(
      requestPaymentReversal(db, auditeur, {
        reference: view.reference,
        reason: "Erreur de saisie",
      }),
    ).rejects.toThrow(/forbidden/);
    await expect(
      requestPaymentReversal(db, finances, { reference: view.reference, reason: "non" }),
    ).rejects.toThrow();

    const r = await requestPaymentReversal(
      db,
      finances,
      { reference: view.reference, reason: "Double débit constaté par le contribuable" },
      { ip: "10.0.0.5" },
    );
    expect(r.status).toBe("reversed");
    expect(r.reversalReference).toMatch(/-REV$/);
    const [after] = await db.select().from(obligations).where(eq(obligations.id, o!.id));
    expect(after).toMatchObject({ status: "due", paidFc: 0 });
    expect(
      await db
        .select()
        .from(paymentAllocations)
        .where(
          eq(
            paymentAllocations.paymentId,
            (await db.select().from(payments).where(eq(payments.reference, view.reference)))[0]!.id,
          ),
        ),
    ).toHaveLength(0);
    const [receipt] = await db.select().from(receipts).where(eq(receipts.receiptNo, r.receiptNo!));
    expect(receipt).toMatchObject({
      status: "cancelled",
      cancelledReason: "Double débit constaté par le contribuable",
    });
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.reference, view.reference));
    expect(payment!.status).toBe("reversed");
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "payment.reversed"), eq(auditLog.objectId, view.reference)));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.ip).toBe("10.0.0.5");

    // Once only.
    await expect(
      requestPaymentReversal(db, finances, {
        reference: view.reference,
        reason: "Encore une fois",
      }),
    ).rejects.toThrow(/invalid_state/);
    await db
      .update(obligations)
      .set({ status: "cancelled", cancelledReason: "test" })
      .where(eq(obligations.id, o!.id));
  });
});
