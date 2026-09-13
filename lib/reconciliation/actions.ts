import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { actorOf, deviceOf, whereOf, type RequestContext } from "@/lib/admin/context";
import { AdminError } from "@/lib/admin/errors";
import { writeAudit } from "@/lib/audit/write";
import type { Db } from "@/lib/db/client";
import {
  dailyCloses,
  payments,
  providerConfirmations,
  providerStatementLines,
  reconciliationExceptions,
  reconciliationRuns,
  taxpayers,
} from "@/lib/db/schema";
import { canReconcile } from "@/lib/identity/roles";
import type { AdminSession } from "@/lib/identity/session";
import type { PaymentProvider } from "@/lib/payments/provider";
import { generateReference } from "@/lib/payments/reference";
import { availableChannels, getProvider } from "@/lib/payments/registry";
import { applyProviderResult } from "@/lib/payments/service";
import { transition } from "@/lib/payments/state-machine";
import { businessDate } from "@/lib/time";

import { openExceptionCount, type ReconcileChannel } from "./run";

const RESOLUTION = z.string().trim().min(5).max(500);

async function loadOpenException(db: Db, session: AdminSession, exceptionId: string) {
  if (!canReconcile(session.role)) throw new AdminError("forbidden");
  const [row] = await db
    .select({
      e: reconciliationExceptions,
      run: reconciliationRuns,
      line: providerStatementLines,
      payment: payments,
    })
    .from(reconciliationExceptions)
    .innerJoin(reconciliationRuns, eq(reconciliationRuns.id, reconciliationExceptions.runId))
    .leftJoin(
      providerStatementLines,
      eq(providerStatementLines.id, reconciliationExceptions.statementLineId),
    )
    .leftJoin(payments, eq(payments.id, reconciliationExceptions.paymentId))
    .where(eq(reconciliationExceptions.id, exceptionId));
  if (!row) throw new AdminError("not_found", exceptionId);
  if (row.e.status !== "open") throw new AdminError("invalid_state", "exception already resolved");
  return row;
}

async function resolve(
  db: Db,
  session: AdminSession,
  exception: { id: string; type: string; runId: string },
  resolution: string,
  action: string,
  ctx: RequestContext,
  now: Date,
  details: Record<string, unknown> = {},
) {
  await db.transaction(async (tx) => {
    await tx
      .update(reconciliationExceptions)
      .set({ status: "resolved", resolution, resolvedAt: now, resolvedByAdminId: session.adminId })
      .where(eq(reconciliationExceptions.id, exception.id));
    await tx
      .update(reconciliationRuns)
      .set({
        exceptionCount: sql`greatest(${reconciliationRuns.exceptionCount} - 1, 0)`,
      })
      .where(eq(reconciliationRuns.id, exception.runId));
    await writeAudit(tx, {
      actor: actorOf(session),
      action: "reconciliation_exception.resolved",
      object: { type: "reconciliation_exception", id: exception.id },
      details: { type: exception.type, action, resolution, ...details },
      where: whereOf(ctx),
      device: deviceOf(ctx),
    });
  });
}

/** Absent du relevé: ask the provider again; a confirmation with the same reference settles it. */
export async function requeryProvider(
  db: Db,
  session: AdminSession,
  input: { exceptionId: string },
  ctx: RequestContext = {},
  opts: { provider?: PaymentProvider; now?: Date } = {},
): Promise<{ resolved: boolean; providerStatus: string }> {
  const now = opts.now ?? new Date();
  const row = await loadOpenException(db, session, input.exceptionId);
  if (row.e.type !== "missing_at_provider" || !row.payment)
    throw new AdminError("invalid_state", "re-query applies to payments missing at the provider");
  const provider = opts.provider ?? getProvider(row.payment.channel);
  const result = await provider.queryStatus({
    reference: row.payment.reference,
    providerRequestId: row.payment.providerRequestId,
    amountFc: row.payment.amountFc,
    payerPhone: row.payment.payerPhone,
    initiatedAt: row.payment.createdAt,
    now,
  });
  if (result.status !== "confirmed" || result.amountFc !== row.payment.amountFc) {
    await db
      .update(reconciliationExceptions)
      .set({ note: `re-interrogé ${now.toISOString()}: ${result.status}` })
      .where(eq(reconciliationExceptions.id, row.e.id));
    await writeAudit(db, {
      actor: actorOf(session),
      action: "reconciliation_exception.requeried",
      object: { type: "reconciliation_exception", id: row.e.id },
      details: { payment: row.payment.reference, providerStatus: result.status },
      where: whereOf(ctx),
      device: deviceOf(ctx),
    });
    return { resolved: false, providerStatus: result.status };
  }
  await resolve(
    db,
    session,
    row.e,
    `Confirmé par le fournisseur à la re-interrogation (${result.providerReference}).`,
    "requery",
    ctx,
    now,
    { payment: row.payment.reference, providerReference: result.providerReference },
  );
  return { resolved: true, providerStatus: "confirmed" };
}

/** Doublon fournisseur: ask the provider to reverse the second debit; the platform keeps one. */
export async function requestReversal(
  db: Db,
  session: AdminSession,
  input: { exceptionId: string; reason: string },
  ctx: RequestContext = {},
  opts: { provider?: PaymentProvider; now?: Date } = {},
): Promise<{ providerReference: string | null }> {
  const now = opts.now ?? new Date();
  const reason = RESOLUTION.parse(input.reason);
  const row = await loadOpenException(db, session, input.exceptionId);
  if (row.e.type !== "duplicate_at_provider" || !row.line || !row.payment)
    throw new AdminError("invalid_state", "reversal applies to duplicates at the provider");
  const provider = opts.provider ?? getProvider(row.payment.channel);
  const r = await provider.reverse({
    reference: row.payment.reference,
    providerReference: row.line.providerReference,
    amountFc: row.line.amountFc,
    reason,
  });
  if (!r.ok) throw new AdminError("provider_error", "reversal refused");
  await resolve(
    db,
    session,
    row.e,
    `Annulation demandée au fournisseur (${r.providerReference ?? row.line.providerReference}) : ${reason}`,
    "reversal",
    ctx,
    now,
    {
      payment: row.payment.reference,
      duplicateReference: row.line.providerReference,
      reversalReference: r.providerReference ?? null,
    },
  );
  return { providerReference: r.providerReference ?? null };
}

/**
 * Hors plateforme: the provider moved money the platform never saw. The statement line is the
 * provider's own proof (reference, amount, raw), so it becomes a confirmed payment for the
 * taxpayer Finances names (invariant 1 holds: confirmation from the provider's statement).
 */
export async function attachToTaxpayer(
  db: Db,
  session: AdminSession,
  input: { exceptionId: string; taxpayerNo: string },
  ctx: RequestContext = {},
  now = new Date(),
): Promise<{ reference: string; receiptNo: string | null }> {
  const row = await loadOpenException(db, session, input.exceptionId);
  if (row.e.type !== "missing_on_platform" || !row.line)
    throw new AdminError("invalid_state", "attach applies to lines missing on the platform");
  const line = row.line;
  const [tp] = await db
    .select()
    .from(taxpayers)
    .where(and(eq(taxpayers.taxpayerNo, input.taxpayerNo), eq(taxpayers.status, "active")));
  if (!tp) throw new AdminError("not_found", input.taxpayerNo);
  const channel = row.run.provider;
  const reference = await db.transaction(async (tx) => {
    let created: { reference: string } | undefined;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const rows = await tx
        .insert(payments)
        .values({
          reference: generateReference(now),
          taxpayerId: tp.id,
          entityId: null,
          amountFc: line.amountFc,
          channel,
          origin: "counter",
          payerPhone: line.payerPhone ?? tp.phone,
          status: "pending",
          pendingAt: now,
          providerRequestId: null,
          expiresAt: null,
          createdAt: now,
        })
        .onConflictDoNothing({ target: payments.reference })
        .returning({ reference: payments.reference });
      created = rows[0];
    }
    if (!created) throw new AdminError("invalid_state", "reference collision");
    await writeAudit(tx, {
      actor: actorOf(session),
      action: "payment.attached",
      object: { type: "payment", id: created.reference },
      details: {
        taxpayer: tp.taxpayerNo,
        amountFc: line.amountFc,
        channel,
        providerReference: line.providerReference,
        exception: row.e.id,
      },
      where: whereOf(ctx),
      device: deviceOf(ctx),
    });
    return created.reference;
  });
  await applyProviderResult(
    db,
    reference,
    {
      status: "confirmed",
      providerReference: line.providerReference,
      amountFc: line.amountFc,
      payerPhone: line.payerPhone ?? undefined,
      providerTime: line.occurredAt,
      raw: line.raw,
    },
    "statement",
    now,
  );
  const [pay] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.reference, reference));
  await db
    .update(providerStatementLines)
    .set({ matchStatus: "matched", matchedPaymentId: pay!.id })
    .where(eq(providerStatementLines.id, line.id));
  const [receipt] = await db
    .execute<{ receipt_no: string }>(
      sql`select receipt_no from app.receipts where payment_id = ${pay!.id}`,
    )
    .then((r) => r.rows);
  await resolve(
    db,
    session,
    row.e,
    `Rattaché à ${tp.taxpayerNo} · paiement ${reference}${receipt ? ` · reçu ${receipt.receipt_no}` : ""}`,
    "attach",
    ctx,
    now,
    { taxpayer: tp.taxpayerNo, payment: reference, receiptNo: receipt?.receipt_no ?? null },
  );
  return { reference, receiptNo: receipt?.receipt_no ?? null };
}

/** Statut différent: the provider settled a payment the platform had given up on (D28). */
export async function confirmFromStatement(
  db: Db,
  session: AdminSession,
  input: { exceptionId: string },
  ctx: RequestContext = {},
  now = new Date(),
): Promise<{ status: string }> {
  const row = await loadOpenException(db, session, input.exceptionId);
  if (row.e.type !== "status_mismatch" || !row.line || !row.payment)
    throw new AdminError("invalid_state", "applies to status mismatches");
  const t = transition(row.payment.status, "provider_confirmed");
  if (!t.ok) throw new AdminError("invalid_state", `${row.payment.status} cannot be confirmed`);
  const r = await applyProviderResult(
    db,
    row.payment.reference,
    {
      status: "confirmed",
      providerReference: row.line.providerReference,
      amountFc: row.line.amountFc,
      payerPhone: row.line.payerPhone ?? undefined,
      providerTime: row.line.occurredAt,
      raw: row.line.raw,
    },
    "statement",
    now,
  );
  await db
    .update(providerStatementLines)
    .set({ matchStatus: "matched", matchedPaymentId: row.payment.id })
    .where(eq(providerStatementLines.id, row.line.id));
  await resolve(
    db,
    session,
    row.e,
    `Confirmé depuis le relevé (${row.line.providerReference})${r.late ? " · confirmation tardive" : ""}.`,
    "confirm_from_statement",
    ctx,
    now,
    { payment: row.payment.reference, late: r.late },
  );
  return { status: r.status };
}

/** Any type: Finances records what was done outside the platform (refund, letter, error). */
export async function resolveManually(
  db: Db,
  session: AdminSession,
  input: { exceptionId: string; resolution: string },
  ctx: RequestContext = {},
  now = new Date(),
): Promise<void> {
  const resolution = RESOLUTION.parse(input.resolution);
  const row = await loadOpenException(db, session, input.exceptionId);
  await resolve(db, session, row.e, resolution, "manual", ctx, now);
}

/**
 * Daily close (the prototype's "Historique des clôtures"): every offered channel must have a
 * completed run for the day (a missing statement blocks, review note) and no exception may be
 * open. Records the day's confirmed transactions.
 */
export async function closeDay(
  db: Db,
  session: AdminSession,
  input: { businessDate: string; note?: string },
  ctx: RequestContext = {},
  now = new Date(),
  channels: ReconcileChannel[] = availableChannels(),
): Promise<{ transactionCount: number; totalFc: number }> {
  if (!canReconcile(session.role)) throw new AdminError("forbidden");
  const day = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .parse(input.businessDate);
  if (day > businessDate(now)) throw new AdminError("invalid_input", "cannot close a future day");
  const [closed] = await db.select().from(dailyCloses).where(eq(dailyCloses.businessDate, day));
  if (closed) throw new AdminError("already_closed", day);
  const runs = await db
    .select()
    .from(reconciliationRuns)
    .where(eq(reconciliationRuns.businessDate, day));
  for (const channel of channels) {
    const run = runs.find((r) => r.provider === channel);
    if (!run || run.status !== "completed") throw new AdminError("missing_statement", channel);
  }
  const open = await openExceptionCount(db, day);
  if (open > 0) throw new AdminError("open_exceptions", String(open));
  const [totals] = await db
    .select({
      n: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${payments.amountFc}), 0)::int`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.status, "confirmed"),
        sql`util.business_date(${payments.confirmedAt}) = ${day}::date`,
      ),
    );
  await db.transaction(async (tx) => {
    await tx.insert(dailyCloses).values({
      businessDate: day,
      closedAt: now,
      closedByAdminId: session.adminId,
      transactionCount: totals?.n ?? 0,
      totalFc: totals?.total ?? 0,
      note: input.note?.trim() || null,
    });
    await writeAudit(tx, {
      actor: actorOf(session),
      action: "daily_close.created",
      object: { type: "daily_close", id: day },
      details: {
        transactionCount: totals?.n ?? 0,
        totalFc: totals?.total ?? 0,
        resolvedExceptions: await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(reconciliationExceptions)
          .where(
            and(
              sql`${reconciliationExceptions.runId} in (select id from app.reconciliation_runs where business_date = ${day}::date)`,
              eq(reconciliationExceptions.status, "resolved"),
            ),
          )
          .then((r) => r[0]?.n ?? 0),
      },
      where: whereOf(ctx),
      device: deviceOf(ctx),
    });
  });
  return { transactionCount: totals?.n ?? 0, totalFc: totals?.total ?? 0 };
}

/** Recent closes for the history block. */
export async function closeHistory(db: Db, limit = 10) {
  return db
    .select({
      businessDate: dailyCloses.businessDate,
      closedAt: dailyCloses.closedAt,
      transactionCount: dailyCloses.transactionCount,
      totalFc: dailyCloses.totalFc,
      note: dailyCloses.note,
      closedBy: sql<
        string | null
      >`(select full_name from app.admin_users where id = ${dailyCloses.closedByAdminId})`,
      resolved: sql<number>`(select count(*)::int from app.reconciliation_exceptions e join app.reconciliation_runs r on r.id = e.run_id where r.business_date = ${dailyCloses.businessDate} and e.status = 'resolved')`,
    })
    .from(dailyCloses)
    .orderBy(desc(dailyCloses.businessDate))
    .limit(limit);
}

export { providerConfirmations };
