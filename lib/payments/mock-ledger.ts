import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { payments, providerConfirmations } from "@/lib/db/schema";

import type { PaymentChannel, StatementLine } from "./provider";

/**
 * Turns the platform's own confirmed payments of a day into "the provider's statement", then
 * perturbs it the way real statements go wrong (docs/MILESTONES.md M9): the most recent
 * confirmation is missing, the one before it is debited twice, and one line belongs to nobody.
 * Pure, so the shape is unit-tested; `mockStatementFromLedger` feeds it from the database.
 */
export function perturbStatement(
  lines: StatementLine[],
  date: string,
  channel: PaymentChannel,
): StatementLine[] {
  // Payments confirmed from a statement (attached by Finances) are, by definition, on the
  // statement: they are never the ones that go missing, so a resolved day stays clean on re-run.
  const fromStatement = (l: StatementLine) =>
    (l.raw as { origin?: string } | null)?.origin === "counter";
  const sorted = [...lines].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const candidates = sorted.filter((l) => !fromStatement(l));
  const missing = candidates[candidates.length - 1];
  const duplicated = candidates[candidates.length - 2];
  const out = sorted.filter((l) => l !== missing);
  if (duplicated) {
    out.push({
      ...duplicated,
      providerReference: `${duplicated.providerReference}-DUP`,
      raw: { ...(duplicated.raw as object), mock: "duplicate_at_provider" },
    });
  }
  out.push({
    providerReference: `AM-${date.replace(/-/g, "")}-${channel.toUpperCase()}-001`,
    platformReference: null,
    amountFc: 5000,
    occurredAt: new Date(`${date}T16:20:00+02:00`),
    payerPhone: "+243810000921",
    raw: { mock: "missing_on_platform", omitted: missing?.providerReference ?? null },
  });
  return out;
}

/** Confirmed payments of `channel` on the business day, as the provider would list them. */
export async function ledgerLines(date: string, channel: PaymentChannel): Promise<StatementLine[]> {
  const rows = await getDb()
    .select({
      reference: payments.reference,
      amountFc: payments.amountFc,
      payerPhone: payments.payerPhone,
      confirmedAt: payments.confirmedAt,
      origin: payments.origin,
      providerReference: providerConfirmations.providerReference,
    })
    .from(payments)
    .innerJoin(providerConfirmations, eq(providerConfirmations.paymentId, payments.id))
    .where(
      and(
        eq(payments.channel, channel),
        eq(payments.status, "confirmed"),
        sql`util.business_date(${payments.confirmedAt}) = ${date}::date`,
      ),
    );
  return rows.map((r) => ({
    providerReference: r.providerReference,
    platformReference: r.reference,
    amountFc: r.amountFc,
    occurredAt: r.confirmedAt ?? new Date(`${date}T12:00:00+02:00`),
    payerPhone: r.payerPhone,
    raw: { mock: "ledger", reference: r.reference, origin: r.origin },
  }));
}

export async function mockStatementFromLedger(
  date: string,
  channel: PaymentChannel,
): Promise<StatementLine[]> {
  return perturbStatement(await ledgerLines(date, channel), date, channel);
}
