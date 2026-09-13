import { desc, eq, inArray, sql } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import {
  dailyCloses,
  payments,
  providerStatementLines,
  reconciliationExceptions,
  reconciliationRuns,
  taxpayers,
} from "@/lib/db/schema";
import type { PaymentChannel } from "@/lib/payments/provider";

import type { ExceptionType } from "./match";
import type { ReconcileChannel } from "./run";

export interface ExceptionView {
  id: string;
  type: ExceptionType;
  status: "open" | "resolved";
  provider: PaymentChannel;
  platformReference: string | null;
  providerReference: string | null;
  platformAmountFc: number | null;
  statementAmountFc: number | null;
  taxpayerNo: string | null;
  taxpayerName: string | null;
  payerPhone: string | null;
  paymentStatus: string | null;
  resolution: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface DayView {
  businessDate: string;
  runs: Array<{
    provider: ReconcileChannel;
    run: typeof reconciliationRuns.$inferSelect | null;
  }>;
  totals: {
    platformCount: number;
    platformTotalFc: number;
    statementCount: number;
    statementTotalFc: number;
    matchedCount: number;
    openExceptions: number;
  };
  exceptions: ExceptionView[];
  close: typeof dailyCloses.$inferSelect | null;
}

/** Everything the Rapprochement screen shows for one business day. */
export async function reconciliationDay(
  db: Db,
  businessDate: string,
  channels: ReconcileChannel[],
): Promise<DayView> {
  const runs = await db
    .select()
    .from(reconciliationRuns)
    .where(eq(reconciliationRuns.businessDate, businessDate));
  const perChannel = channels.map((provider) => ({
    provider,
    run: runs.find((r) => r.provider === provider) ?? null,
  }));
  const runIds = runs.map((r) => r.id);
  const exceptionRows = runIds.length
    ? await db
        .select({
          e: reconciliationExceptions,
          provider: reconciliationRuns.provider,
          payment: {
            reference: payments.reference,
            status: payments.status,
            taxpayerId: payments.taxpayerId,
          },
          line: {
            providerReference: providerStatementLines.providerReference,
            platformReference: providerStatementLines.platformReference,
            payerPhone: providerStatementLines.payerPhone,
          },
          taxpayerNo: taxpayers.taxpayerNo,
          taxpayerName: taxpayers.fullName,
        })
        .from(reconciliationExceptions)
        .innerJoin(reconciliationRuns, eq(reconciliationRuns.id, reconciliationExceptions.runId))
        .leftJoin(payments, eq(payments.id, reconciliationExceptions.paymentId))
        .leftJoin(
          providerStatementLines,
          eq(providerStatementLines.id, reconciliationExceptions.statementLineId),
        )
        .leftJoin(taxpayers, eq(taxpayers.id, payments.taxpayerId))
        .where(inArray(reconciliationExceptions.runId, runIds))
        .orderBy(
          sql`case when ${reconciliationExceptions.status} = 'open' then 0 else 1 end`,
          desc(reconciliationExceptions.createdAt),
        )
    : [];
  const [close] = await db
    .select()
    .from(dailyCloses)
    .where(eq(dailyCloses.businessDate, businessDate));
  const completed = runs.filter((r) => r.status === "completed");
  const sum = (k: keyof typeof reconciliationRuns.$inferSelect) =>
    completed.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  return {
    businessDate,
    runs: perChannel,
    totals: {
      platformCount: sum("platformCount"),
      platformTotalFc: sum("platformTotalFc"),
      statementCount: sum("statementCount"),
      statementTotalFc: sum("statementTotalFc"),
      matchedCount: sum("matchedCount"),
      openExceptions: exceptionRows.filter((r) => r.e.status === "open").length,
    },
    exceptions: exceptionRows.map((r) => ({
      id: r.e.id,
      type: r.e.type,
      status: r.e.status,
      provider: r.provider,
      platformReference: r.payment?.reference ?? r.line?.platformReference ?? null,
      providerReference: r.line?.providerReference ?? null,
      platformAmountFc: r.e.platformAmountFc,
      statementAmountFc: r.e.statementAmountFc,
      taxpayerNo: r.taxpayerNo ?? null,
      taxpayerName: r.taxpayerName ?? null,
      payerPhone: r.line?.payerPhone ?? null,
      paymentStatus: r.payment?.status ?? null,
      resolution: r.e.resolution,
      resolvedAt: r.e.resolvedAt,
      createdAt: r.e.createdAt,
    })),
    close: close ?? null,
  };
}
