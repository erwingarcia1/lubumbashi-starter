import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "@/lib/audit/write";
import type { Db, Tx } from "@/lib/db/client";
import {
  notifications,
  obligations,
  paymentAllocations,
  payments,
  providerConfirmations,
  receipts,
  taxRules,
  taxpayers,
} from "@/lib/db/schema";
import { issueReceipt, type ReceiptAllocation } from "@/lib/receipts/issue";
import { allocatePayment, obligationStatus } from "@/lib/tax-engine";

import type { PaymentChannel, StatusResult } from "./provider";
import { generateReference } from "./reference";
import { getProvider, paymentExpiryHours } from "./registry";
import { transition, type PaymentStatus } from "./state-machine";

export type PaymentErrorCode =
  | "taxpayer_not_found"
  | "nothing_to_pay"
  | "payment_not_found"
  | "invalid_transition"
  | "amount_mismatch"
  | "reference_collision";

export class PaymentError extends Error {
  constructor(
    readonly code: PaymentErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "PaymentError";
  }
}

export type PaymentActor =
  | {
      type: "agent";
      agentId: string;
      matricule: string;
      deviceId: string;
      gps?: { lng: number; lat: number };
    }
  | { type: "taxpayer"; taxpayerId: string; taxpayerNo: string; ip?: string; userAgent?: string };

export const initiateInput = z.object({
  taxpayerNo: z.string().regex(/^LUB-[A-Z]{3}-\d{8}$/),
  channel: z.enum(["mpesa", "airtel", "orange", "tpe"]),
  /** Optional subset; the server derives the amount from the obligations, never from the client. */
  obligationIds: z.array(z.uuid()).max(50).optional(),
});
export type InitiateInput = z.infer<typeof initiateInput>;

export interface PaymentView {
  reference: string;
  status: PaymentStatus;
  amountFc: number;
  channel: PaymentChannel;
  payerPhone: string;
  taxpayerNo: string;
  failureReason: string | null;
  receiptNo: string | null;
  verifyToken: string | null;
  providerReference: string | null;
  expiresAt: Date | null;
  initiatedAt: Date;
}

async function openObligations(db: Db | Tx, taxpayerId: string, ids?: string[]) {
  const where = ids?.length
    ? and(
        eq(obligations.taxpayerId, taxpayerId),
        inArray(obligations.id, ids),
        inArray(obligations.status, ["due", "partially_paid"]),
      )
    : and(
        eq(obligations.taxpayerId, taxpayerId),
        inArray(obligations.status, ["due", "partially_paid"]),
      );
  return db.select().from(obligations).where(where).orderBy(asc(obligations.dueDate));
}

/**
 * Creates the payment attempt: server-side amount (outstanding of the selected or all open
 * obligations), payer number on file, unique reference before the provider is called
 * (invariant 5), then hands it to the provider. Agents can only reach this (invariant 2).
 */
export async function initiatePayment(
  db: Db,
  actor: PaymentActor,
  raw: InitiateInput,
  now = new Date(),
): Promise<PaymentView> {
  const input = initiateInput.parse(raw);
  const [tp] = await db.select().from(taxpayers).where(eq(taxpayers.taxpayerNo, input.taxpayerNo));
  if (!tp) throw new PaymentError("taxpayer_not_found", input.taxpayerNo);
  const open = await openObligations(db, tp.id, input.obligationIds);
  const amountFc = open.reduce(
    (sum, o) => sum + Math.max(0, o.amountFc + o.penaltyFc - o.paidFc),
    0,
  );
  if (amountFc <= 0) throw new PaymentError("nothing_to_pay");
  const provider = getProvider(input.channel);
  const expiresAt = new Date(now.getTime() + paymentExpiryHours() * 3_600_000);

  const created = await db.transaction(async (tx) => {
    let inserted: { id: string; reference: string } | undefined;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const reference = generateReference(now);
      const rows = await tx
        .insert(payments)
        .values({
          reference,
          taxpayerId: tp.id,
          entityId: open[0]?.entityId ?? null,
          amountFc,
          channel: input.channel,
          origin: actor.type === "agent" ? "agent" : "portal",
          payerPhone: tp.phone,
          status: "initiated",
          targetObligationIds: input.obligationIds?.length ? open.map((o) => o.id) : null,
          initiatedByAgentId: actor.type === "agent" ? actor.agentId : null,
          initiatedDeviceId: actor.type === "agent" ? actor.deviceId : null,
          expiresAt,
          createdAt: now,
        })
        .onConflictDoNothing({ target: payments.reference })
        .returning({ id: payments.id, reference: payments.reference });
      inserted = rows[0];
    }
    if (!inserted) throw new PaymentError("reference_collision");
    await writeAudit(tx, {
      actor:
        actor.type === "agent"
          ? { type: "agent", id: actor.agentId, role: "agent", label: actor.matricule }
          : { type: "taxpayer", id: actor.taxpayerId, label: actor.taxpayerNo },
      action: "payment.initiated",
      object: { type: "payment", id: inserted.reference },
      details: { amountFc, channel: input.channel, obligations: open.map((o) => o.id) },
      where:
        actor.type === "agent" && actor.gps
          ? { gps: actor.gps }
          : actor.type === "taxpayer" && actor.ip
            ? { ip: actor.ip }
            : undefined,
      device:
        actor.type === "agent"
          ? { id: actor.deviceId }
          : actor.type === "taxpayer" && actor.userAgent
            ? { userAgent: actor.userAgent }
            : undefined,
    });
    return inserted;
  });

  const result = await provider.initiate({
    reference: created.reference,
    amountFc,
    payerPhone: tp.phone,
    channel: input.channel,
    description: `Ville de Lubumbashi ${created.reference}`,
  });
  await db.transaction(async (tx) => {
    const t = transition(
      "initiated",
      result.status === "pending" ? "provider_accepted" : "provider_rejected",
    );
    if (!t.ok) throw new PaymentError("invalid_transition");
    await tx
      .update(payments)
      .set({
        status: t.to,
        providerRequestId: result.providerRequestId,
        pendingAt: t.to === "pending" ? now : null,
        failedAt: t.to === "failed" ? now : null,
        failureReason: result.failureReason ?? null,
        updatedAt: now,
      })
      .where(eq(payments.id, created.id));
    await writeAudit(tx, {
      actor: { type: "system" },
      action: t.to === "pending" ? "payment.pending" : "payment.failed",
      object: { type: "payment", id: created.reference },
      details: {
        provider: provider.name,
        providerRequestId: result.providerRequestId,
        reason: result.failureReason ?? null,
      },
    });
  });
  return (await getPaymentView(db, created.reference))!;
}

export async function getPaymentView(db: Db | Tx, reference: string): Promise<PaymentView | null> {
  const [row] = await db
    .select({
      p: payments,
      taxpayerNo: taxpayers.taxpayerNo,
      receiptNo: receipts.receiptNo,
      verifyToken: receipts.verifyToken,
      providerReference: providerConfirmations.providerReference,
    })
    .from(payments)
    .innerJoin(taxpayers, eq(taxpayers.id, payments.taxpayerId))
    .leftJoin(receipts, eq(receipts.paymentId, payments.id))
    .leftJoin(providerConfirmations, eq(providerConfirmations.paymentId, payments.id))
    .where(eq(payments.reference, reference));
  if (!row) return null;
  return {
    reference: row.p.reference,
    status: row.p.status,
    amountFc: row.p.amountFc,
    channel: row.p.channel,
    payerPhone: row.p.payerPhone,
    taxpayerNo: row.taxpayerNo,
    failureReason: row.p.failureReason,
    receiptNo: row.receiptNo,
    verifyToken: row.verifyToken,
    providerReference: row.providerReference,
    expiresAt: row.p.expiresAt,
    initiatedAt: row.p.createdAt,
  };
}

export type ResultSource = "callback" | "query" | "statement";

/**
 * Applies what the provider says. Idempotent: the same confirmation twice is one row and one
 * receipt (invariant 5); `confirmed` is written only together with its provider_confirmation
 * (invariant 1, also enforced by the database trigger); allocation, obligation statuses, the
 * receipt and the receipt SMS happen in the same transaction (invariant 7).
 */
export async function applyProviderResult(
  db: Db,
  reference: string,
  result: StatusResult,
  source: ResultSource,
  now = new Date(),
): Promise<{ applied: boolean; status: PaymentStatus; late: boolean }> {
  return db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(payments)
      .where(eq(payments.reference, reference))
      .for("update");
    if (!p) throw new PaymentError("payment_not_found", reference);
    if (result.status === "pending") return { applied: false, status: p.status, late: false };

    if (result.status === "failed") {
      const t = transition(p.status, "provider_failed");
      if (!t.ok) return { applied: false, status: p.status, late: false };
      await tx
        .update(payments)
        .set({
          status: "failed",
          failedAt: now,
          failureReason: result.failureReason,
          updatedAt: now,
        })
        .where(eq(payments.id, p.id));
      await writeAudit(tx, {
        actor: { type: "system" },
        action: "payment.failed",
        object: { type: "payment", id: reference },
        details: { source, code: result.failureCode ?? null, reason: result.failureReason },
      });
      return { applied: true, status: "failed", late: false };
    }

    // confirmed
    const [existing] = await tx
      .select()
      .from(providerConfirmations)
      .where(eq(providerConfirmations.paymentId, p.id));
    if (existing) {
      if (existing.providerReference === result.providerReference)
        return { applied: false, status: p.status, late: false };
      throw new PaymentError("invalid_transition", "a different confirmation already exists");
    }
    const t = transition(p.status, "provider_confirmed");
    if (!t.ok) {
      if (t.reason === "already_final") return { applied: false, status: p.status, late: false };
      throw new PaymentError("invalid_transition", `${p.status} cannot be confirmed`);
    }
    if (result.amountFc !== p.amountFc)
      throw new PaymentError("amount_mismatch", `${result.amountFc} ≠ ${p.amountFc}`);

    const provider = p.channel === "mock" ? "mock" : getProvider(p.channel).name;
    await tx.insert(providerConfirmations).values({
      paymentId: p.id,
      provider,
      providerReference: result.providerReference,
      amountFc: result.amountFc,
      payerPhone: result.payerPhone ?? null,
      rawPayload: result.raw as object,
      receivedAt: now,
      createdAt: now,
    });
    await tx
      .update(payments)
      .set({ status: "confirmed", confirmedAt: now, updatedAt: now })
      .where(eq(payments.id, p.id));

    // Allocation oldest-first (D5), then obligation statuses, then the receipt.
    const open = await openObligations(tx, p.taxpayerId);
    // The payer's chosen obligations first, then the rest; oldest-first within each group (D5).
    const targeted = new Set(p.targetObligationIds ?? []);
    const asBalance = (o: (typeof open)[number]) => ({
      id: o.id,
      dueDate: o.dueDate,
      amountFc: o.amountFc,
      penaltyFc: o.penaltyFc,
      paidFc: o.paidFc,
    });
    const first = allocatePayment(
      p.amountFc,
      open.filter((o) => targeted.size === 0 || targeted.has(o.id)).map(asBalance),
    );
    const rest =
      first.remainderFc > 0 && targeted.size > 0
        ? allocatePayment(first.remainderFc, open.filter((o) => !targeted.has(o.id)).map(asBalance))
        : { allocations: [], remainderFc: first.remainderFc };
    const allocations = [...first.allocations, ...rest.allocations];
    const remainderFc = rest.remainderFc;
    const ruleRows = open.length
      ? await tx
          .select({ id: taxRules.id, code: taxRules.code, labelFr: taxRules.labelFr })
          .from(taxRules)
          .where(inArray(taxRules.id, [...new Set(open.map((o) => o.taxRuleId))]))
      : [];
    const receiptAllocations: ReceiptAllocation[] = [];
    for (const a of allocations) {
      const o = open.find((x) => x.id === a.obligationId)!;
      await tx.insert(paymentAllocations).values({
        paymentId: p.id,
        obligationId: a.obligationId,
        kind: a.kind,
        amountFc: a.amountFc,
      });
      const paidFc = o.paidFc + a.amountFc;
      o.paidFc = paidFc;
      await tx
        .update(obligations)
        .set({
          paidFc,
          status: obligationStatus({ amountFc: o.amountFc, penaltyFc: o.penaltyFc, paidFc }),
          updatedAt: now,
        })
        .where(eq(obligations.id, o.id));
      const rule = ruleRows.find((r) => r.id === o.taxRuleId);
      receiptAllocations.push({
        ruleCode: rule?.code ?? "",
        ruleLabelFr: rule?.labelFr ?? "",
        periodStart: o.periodStart,
        periodEnd: o.periodEnd,
        kind: a.kind,
        amountFc: a.amountFc,
      });
    }
    const [tp] = await tx
      .select({
        taxpayerNo: taxpayers.taxpayerNo,
        fullName: taxpayers.fullName,
        phone: taxpayers.phone,
      })
      .from(taxpayers)
      .where(eq(taxpayers.id, p.taxpayerId));
    const agentMatricule = p.initiatedByAgentId
      ? ((
          await tx.execute<{ matricule: string }>(
            sql`select matricule from app.agents where id = ${p.initiatedByAgentId}`,
          )
        ).rows[0]?.matricule ?? null)
      : null;
    const receipt = await issueReceipt(
      tx,
      {
        paymentId: p.id,
        taxpayerId: p.taxpayerId,
        taxpayerNo: tp!.taxpayerNo,
        taxpayerName: tp!.fullName,
        amountFc: p.amountFc,
        channel: p.channel,
        providerReference: result.providerReference,
        agentMatricule,
        allocations: receiptAllocations,
      },
      now,
    );
    await tx.insert(notifications).values({
      taxpayerId: p.taxpayerId,
      kind: "receipt",
      channel: "sms",
      to: tp!.phone,
      templateKey: "receipt",
      payload: {
        receiptNo: receipt.receiptNo,
        amountFc: p.amountFc,
        verifyToken: receipt.verifyToken,
        reference,
      },
    });
    await writeAudit(tx, {
      actor: { type: "system" },
      action: "payment.confirmed",
      object: { type: "payment", id: reference },
      details: {
        provider,
        providerReference: result.providerReference,
        source,
        late: t.late,
        amountFc: p.amountFc,
        receiptNo: receipt.receiptNo,
        overpaymentFc: remainderFc,
      },
    });
    await writeAudit(tx, {
      actor: { type: "system" },
      action: "receipt.issued",
      object: { type: "receipt", id: receipt.receiptNo },
      details: { payment: reference, amountFc: p.amountFc },
    });
    return { applied: true, status: "confirmed", late: t.late };
  });
}

/** Re-asks the provider for a pending payment; expires it after PAYMENT_EXPIRY_HOURS (D28). */
export async function syncPaymentStatus(
  db: Db,
  reference: string,
  now = new Date(),
): Promise<PaymentView | null> {
  const view = await getPaymentView(db, reference);
  if (!view) return null;
  if (view.status !== "pending") return view;
  const provider = getProvider(view.channel);
  const [p] = await db
    .select({ providerRequestId: payments.providerRequestId })
    .from(payments)
    .where(eq(payments.reference, reference));
  const result = await provider.queryStatus({
    reference,
    providerRequestId: p?.providerRequestId ?? null,
    amountFc: view.amountFc,
    payerPhone: view.payerPhone,
    initiatedAt: view.initiatedAt,
    now,
  });
  const expiresAt = view.expiresAt;
  if (result.status !== "pending") {
    await applyProviderResult(db, reference, result, "query", now);
  } else if (expiresAt && now > expiresAt) {
    await db.transaction(async (tx) => {
      const t = transition("pending", "expired");
      if (!t.ok) return;
      await tx
        .update(payments)
        .set({ status: "expired", expiredAt: now, updatedAt: now })
        .where(eq(payments.reference, reference));
      await writeAudit(tx, {
        actor: { type: "system" },
        action: "payment.expired",
        object: { type: "payment", id: reference },
        details: { after: expiresAt.toISOString() },
      });
    });
  }
  return getPaymentView(db, reference);
}
