import { and, eq, inArray, sql } from "drizzle-orm";

import { writeAudit } from "@/lib/audit/write";
import type { Db } from "@/lib/db/client";
import {
  payments,
  providerConfirmations,
  providerStatementLines,
  reconciliationExceptions,
  reconciliationRuns,
} from "@/lib/db/schema";
import type { PaymentChannel, PaymentProvider } from "@/lib/payments/provider";
import { getProvider } from "@/lib/payments/registry";

import { matchStatement, type PlatformPayment } from "./match";

export type ReconcileChannel = Exclude<PaymentChannel, "mock">;

export interface RunSummary {
  runId: string;
  businessDate: string;
  provider: ReconcileChannel;
  status: "completed" | "failed";
  platformCount: number;
  platformTotalFc: number;
  statementCount: number;
  statementTotalFc: number;
  matchedCount: number;
  exceptionCount: number;
  newExceptions: number;
  error: string | null;
}

/**
 * Nightly (or on-demand) reconciliation of one provider for one business day (Africa/Lubumbashi).
 * Re-running the same day keeps the statement lines and the exceptions already resolved (an
 * exception resolved by Finances is never reopened); open exceptions are recomputed.
 */
export async function runReconciliation(
  db: Db,
  businessDate: string,
  channel: ReconcileChannel,
  opts: { provider?: PaymentProvider; now?: Date } = {},
): Promise<RunSummary> {
  const now = opts.now ?? new Date();
  const provider = opts.provider ?? getProvider(channel);

  // 1. The run row (one per day and provider).
  const runId = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: reconciliationRuns.id })
      .from(reconciliationRuns)
      .where(
        and(
          eq(reconciliationRuns.businessDate, businessDate),
          eq(reconciliationRuns.provider, channel),
        ),
      );
    if (existing) {
      await tx
        .update(reconciliationRuns)
        .set({ status: "running", startedAt: now, finishedAt: null, error: null })
        .where(eq(reconciliationRuns.id, existing.id));
      await tx
        .delete(reconciliationExceptions)
        .where(
          and(
            eq(reconciliationExceptions.runId, existing.id),
            eq(reconciliationExceptions.status, "open"),
          ),
        );
      return existing.id;
    }
    const [created] = await tx
      .insert(reconciliationRuns)
      .values({ businessDate, provider: channel, status: "running", startedAt: now })
      .returning({ id: reconciliationRuns.id });
    return created!.id;
  });

  // 2. The provider's statement.
  let statement;
  try {
    statement = await provider.fetchStatement(businessDate, channel);
  } catch (err) {
    const error = String(err).slice(0, 500);
    await db
      .update(reconciliationRuns)
      .set({ status: "failed", finishedAt: now, error })
      .where(eq(reconciliationRuns.id, runId));
    return {
      runId,
      businessDate,
      provider: channel,
      status: "failed",
      platformCount: 0,
      platformTotalFc: 0,
      statementCount: 0,
      statementTotalFc: 0,
      matchedCount: 0,
      exceptionCount: 0,
      newExceptions: 0,
      error,
    };
  }

  return db.transaction(async (tx) => {
    // 3. Statement lines, kept as received (upsert on the provider's own reference).
    for (const l of statement) {
      await tx
        .insert(providerStatementLines)
        .values({
          runId,
          provider: channel,
          providerReference: l.providerReference,
          platformReference: l.platformReference,
          amountFc: l.amountFc,
          occurredAt: l.occurredAt,
          payerPhone: l.payerPhone ?? null,
          raw: l.raw as object,
          matchStatus: "unmatched",
          matchedPaymentId: null,
        })
        .onConflictDoUpdate({
          target: [
            providerStatementLines.runId,
            providerStatementLines.provider,
            providerStatementLines.providerReference,
          ],
          set: {
            platformReference: l.platformReference,
            amountFc: l.amountFc,
            occurredAt: l.occurredAt,
            payerPhone: l.payerPhone ?? null,
            raw: l.raw as object,
            matchStatus: "unmatched",
            matchedPaymentId: null,
          },
        });
    }
    const lines = await tx
      .select()
      .from(providerStatementLines)
      .where(eq(providerStatementLines.runId, runId))
      .orderBy(providerStatementLines.occurredAt, providerStatementLines.providerReference);

    // 4. The platform's side: confirmed that day, or attempted that day and never confirmed.
    const platformRows = await tx
      .select({
        id: payments.id,
        reference: payments.reference,
        amountFc: payments.amountFc,
        status: payments.status,
        providerReference: providerConfirmations.providerReference,
      })
      .from(payments)
      .leftJoin(providerConfirmations, eq(providerConfirmations.paymentId, payments.id))
      .where(
        and(
          eq(payments.channel, channel),
          sql`(
            (${payments.status} = 'confirmed' and util.business_date(${payments.confirmedAt}) = ${businessDate}::date)
            or (${payments.status} <> 'confirmed' and util.business_date(${payments.createdAt}) = ${businessDate}::date)
          )`,
        ),
      );
    const platform: PlatformPayment[] = platformRows.map((p) => ({
      id: p.id,
      reference: p.reference,
      providerReference: p.providerReference,
      amountFc: p.amountFc,
      status: p.status,
    }));

    // 5. Match.
    const result = matchStatement(
      platform,
      lines.map((l, index) => ({
        index,
        providerReference: l.providerReference,
        platformReference: l.platformReference,
        amountFc: l.amountFc,
      })),
    );
    for (const m of result.matches) {
      await tx
        .update(providerStatementLines)
        .set({ matchStatus: "matched", matchedPaymentId: m.paymentId })
        .where(eq(providerStatementLines.id, lines[m.lineIndex]!.id));
    }

    // 6. Exceptions, minus the ones Finances already resolved for this day.
    const resolved = await tx
      .select({
        type: reconciliationExceptions.type,
        paymentId: reconciliationExceptions.paymentId,
        statementLineId: reconciliationExceptions.statementLineId,
      })
      .from(reconciliationExceptions)
      .where(
        and(
          eq(reconciliationExceptions.runId, runId),
          eq(reconciliationExceptions.status, "resolved"),
        ),
      );
    const alreadyResolved = new Set(
      resolved.map((r) => `${r.type}|${r.paymentId ?? ""}|${r.statementLineId ?? ""}`),
    );
    let newExceptions = 0;
    for (const e of result.exceptions) {
      const lineId = e.lineIndex === undefined ? null : lines[e.lineIndex]!.id;
      const key = `${e.type}|${e.paymentId ?? ""}|${lineId ?? ""}`;
      if (alreadyResolved.has(key)) continue;
      await tx.insert(reconciliationExceptions).values({
        runId,
        type: e.type,
        status: "open",
        paymentId: e.paymentId ?? null,
        statementLineId: lineId,
        platformAmountFc: e.platformAmountFc ?? null,
        statementAmountFc: e.statementAmountFc ?? null,
        createdAt: now,
      });
      newExceptions += 1;
    }
    const openRow = (
      await tx
        .select({ open: sql<number>`count(*)::int` })
        .from(reconciliationExceptions)
        .where(
          and(
            eq(reconciliationExceptions.runId, runId),
            eq(reconciliationExceptions.status, "open"),
          ),
        )
    )[0];
    const open = openRow?.open ?? 0;
    await tx
      .update(reconciliationRuns)
      .set({
        status: "completed",
        finishedAt: now,
        platformCount: result.summary.platformCount,
        platformTotalFc: result.summary.platformTotalFc,
        statementCount: result.summary.statementCount,
        statementTotalFc: result.summary.statementTotalFc,
        matchedCount: result.summary.matchedCount,
        exceptionCount: open,
        error: null,
      })
      .where(eq(reconciliationRuns.id, runId));
    await writeAudit(tx, {
      actor: { type: "system" },
      action: "reconciliation.completed",
      object: { type: "reconciliation_run", id: `${businessDate}/${channel}` },
      details: {
        ...result.summary,
        openExceptions: open,
        newExceptions,
        lines: lines.length,
      },
    });
    return {
      runId,
      businessDate,
      provider: channel,
      status: "completed",
      ...result.summary,
      exceptionCount: open,
      newExceptions,
      error: null,
    };
  });
}

/** Runs every offered channel for the day (the nightly job and the "Lancer" button). */
export async function reconcileDay(
  db: Db,
  businessDate: string,
  channels: ReconcileChannel[],
  now = new Date(),
): Promise<RunSummary[]> {
  const out: RunSummary[] = [];
  for (const channel of channels)
    out.push(await runReconciliation(db, businessDate, channel, { now }));
  return out;
}

/** Open exceptions for a day, across providers (the daily close needs zero). */
export async function openExceptionCount(db: Db, businessDate: string): Promise<number> {
  const runs = await db
    .select({ id: reconciliationRuns.id })
    .from(reconciliationRuns)
    .where(eq(reconciliationRuns.businessDate, businessDate));
  if (runs.length === 0) return 0;
  const row = (
    await db
      .select({ n: sql<number>`count(*)::int` })
      .from(reconciliationExceptions)
      .where(
        and(
          inArray(
            reconciliationExceptions.runId,
            runs.map((r) => r.id),
          ),
          eq(reconciliationExceptions.status, "open"),
        ),
      )
  )[0];
  return row?.n ?? 0;
}
