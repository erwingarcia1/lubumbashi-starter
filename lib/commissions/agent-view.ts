import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "@/lib/db/client";
import { commissionLines, commissionRules, commissionStatements } from "@/lib/db/schema";
import { businessDate } from "@/lib/time";

import { computeStatement, totalsOf, type LineDraft } from "./compute";
import { PERIOD_RE, periodRange } from "./period";
import { ruleFor } from "./rules";

const period = z.string().regex(PERIOD_RE);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const status = z.enum(["draft", "approved", "paid"]);
const int = z.number().int();

const totals = z.object({
  collectionsCount: int.nonnegative(),
  collectedFc: int.nonnegative(),
  collectionCommissionFc: int,
  registrationsCount: int.nonnegative(),
  registrationCommissionFc: int.nonnegative(),
  totalFc: int,
});

/** Contract of `GET /api/v1/agent/commissions` and of the "Mes commissions" screen. */
export const agentMonthViewSchema = z.object({
  period,
  /** Null until the month has a stored statement; the figures are then computed live. */
  status: status.nullable(),
  /** True when the figures come from the ledger right now (draft or no statement yet). */
  live: z.boolean(),
  computedAt: z.iso.datetime(),
  approvedAt: z.iso.datetime().nullable(),
  paidAt: z.iso.datetime().nullable(),
  paidReference: z.string().nullable(),
  /** The scale in force at the end of the month (or today, for the current month). */
  rates: z.object({ collectionRateBp: int.nonnegative(), registrationAmountFc: int.nonnegative() }),
  totals,
  days: z.array(
    z.object({
      date: isoDate,
      collectionsCount: int.nonnegative(),
      collectedFc: int.nonnegative(),
      commissionFc: int,
      registrationsCount: int.nonnegative(),
      bonusFc: int.nonnegative(),
      totalFc: int,
    }),
  ),
  /** The agent's other statements, newest first. */
  months: z.array(
    z.object({
      period,
      status,
      totalFc: int,
      approvedAt: z.iso.datetime().nullable(),
      paidAt: z.iso.datetime().nullable(),
      paidReference: z.string().nullable(),
    }),
  ),
});
export type AgentMonthView = z.infer<typeof agentMonthViewSchema>;

function daysOf(lines: readonly LineDraft[]): AgentMonthView["days"] {
  const map = new Map<string, AgentMonthView["days"][number]>();
  for (const l of lines) {
    const d = map.get(l.businessDate) ?? {
      date: l.businessDate,
      collectionsCount: 0,
      collectedFc: 0,
      commissionFc: 0,
      registrationsCount: 0,
      bonusFc: 0,
      totalFc: 0,
    };
    if (l.kind === "collection") {
      d.collectionsCount += 1;
      d.collectedFc += l.baseFc;
      d.commissionFc += l.amountFc;
    } else if (l.kind === "reversal") {
      d.commissionFc += l.amountFc;
    } else {
      d.registrationsCount += 1;
      d.bonusFc += l.amountFc;
    }
    d.totalFc = d.commissionFc + d.bonusFc;
    map.set(l.businessDate, d);
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * What the agent sees: the month's figures (frozen lines once the statement is approved or
 * paid, live otherwise), a per-day breakdown, and the other months with their status.
 */
export async function agentMonthView(
  db: Db,
  agentId: string,
  requested: string,
  now = new Date(),
): Promise<AgentMonthView> {
  const [stored] = await db
    .select()
    .from(commissionStatements)
    .where(
      and(eq(commissionStatements.agentId, agentId), eq(commissionStatements.period, requested)),
    );
  const frozen = !!stored && stored.status !== "draft";
  let lines: LineDraft[];
  let computedAt: Date;
  if (frozen) {
    const rows = await db
      .select()
      .from(commissionLines)
      .where(eq(commissionLines.statementId, stored.id));
    lines = rows.map((r) => ({
      kind: r.kind,
      ruleId: r.ruleId,
      paymentId: r.paymentId,
      taxpayerId: r.taxpayerId,
      businessDate: r.businessDate,
      baseFc: r.baseFc,
      rateBp: r.rateBp,
      amountFc: r.amountFc,
    }));
    computedAt = stored.computedAt;
  } else {
    const c = await computeStatement(db, agentId, requested, now);
    lines = c.lines;
    computedAt = c.computedAt;
  }
  const rules = await db.select().from(commissionRules);
  const today = businessDate(now);
  const { end } = periodRange(requested);
  const asOf = end < today ? end : today;
  const months = await db
    .select()
    .from(commissionStatements)
    .where(
      and(eq(commissionStatements.agentId, agentId), ne(commissionStatements.period, requested)),
    )
    .orderBy(desc(commissionStatements.period))
    .limit(12);
  return agentMonthViewSchema.parse({
    period: requested,
    status: stored?.status ?? null,
    live: !frozen,
    computedAt: computedAt.toISOString(),
    approvedAt: iso(stored?.approvedAt ?? null),
    paidAt: iso(stored?.paidAt ?? null),
    paidReference: stored?.paidReference ?? null,
    rates: {
      collectionRateBp: ruleFor(rules, "collection_percent", asOf)?.rateBp ?? 0,
      registrationAmountFc: ruleFor(rules, "registration_fixed", asOf)?.amountFc ?? 0,
    },
    totals: totalsOf(lines),
    days: daysOf(lines),
    months: months.map((m) => ({
      period: m.period,
      status: m.status,
      totalFc: m.totalFc,
      approvedAt: iso(m.approvedAt),
      paidAt: iso(m.paidAt),
      paidReference: m.paidReference,
    })),
  });
}
