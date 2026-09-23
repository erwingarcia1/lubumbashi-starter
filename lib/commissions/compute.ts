import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";

import type { Db, Tx } from "@/lib/db/client";
import {
  commissionLines,
  commissionRules,
  commissionStatements,
  payments,
  taxpayers,
} from "@/lib/db/schema";

import { periodRange } from "./period";
import { commissionAmount, ruleFor, type RuleLike } from "./rules";

export type LineKind = "collection" | "reversal" | "registration";

/** A statement line before it is stored (the columns of `commission_lines` minus the ids). */
export interface LineDraft {
  kind: LineKind;
  ruleId: string | null;
  paymentId: string | null;
  taxpayerId: string | null;
  businessDate: string;
  /** Amount collected for collection and reversal lines; 0 for fixed amounts. */
  baseFc: number;
  rateBp: number;
  /** Signed: reversals are negative. */
  amountFc: number;
}

export interface StatementTotals {
  collectionsCount: number;
  collectedFc: number;
  /** Net of reversals. */
  collectionCommissionFc: number;
  registrationsCount: number;
  registrationCommissionFc: number;
  totalFc: number;
}

/** A confirmed collection initiated by the agent (its business day is the payment's). */
export interface CollectionAct {
  paymentId: string;
  businessDate: string;
  amountFc: number;
  /** The single tax the payment served, when there is exactly one; null otherwise. */
  taxRuleId: string | null;
}

/** A reversal: deducted in the month it happens, mirroring what the collection earned. */
export interface ReversalAct {
  paymentId: string;
  /** Business day of the reversal. */
  businessDate: string;
  /** Business day of the original collection. */
  collectedOn: string;
  amountFc: number;
  taxRuleId: string | null;
  /** The collection line already stored for this payment (frozen statements first), if any. */
  priorLine: { ruleId: string | null; baseFc: number; rateBp: number; amountFc: number } | null;
}

export interface RegistrationAct {
  taxpayerId: string;
  businessDate: string;
}

export interface ComputeInput {
  rules: readonly RuleLike[];
  collections: readonly CollectionAct[];
  reversals: readonly ReversalAct[];
  registrations: readonly RegistrationAct[];
}

export function emptyTotals(): StatementTotals {
  return {
    collectionsCount: 0,
    collectedFc: 0,
    collectionCommissionFc: 0,
    registrationsCount: 0,
    registrationCommissionFc: 0,
    totalFc: 0,
  };
}

export function totalsOf(lines: readonly LineDraft[]): StatementTotals {
  const t = emptyTotals();
  for (const l of lines) {
    if (l.kind === "collection") {
      t.collectionsCount += 1;
      t.collectedFc += l.baseFc;
      t.collectionCommissionFc += l.amountFc;
    } else if (l.kind === "reversal") {
      t.collectionCommissionFc += l.amountFc;
    } else {
      t.registrationsCount += 1;
      t.registrationCommissionFc += l.amountFc;
    }
  }
  t.totalFc = t.collectionCommissionFc + t.registrationCommissionFc;
  return t;
}

/**
 * Pure: the lines of one agent for one month from its acts and the rule versions. Every act is
 * paid at the rule effective on its own business day; a reversal negates exactly what the
 * collection earned (the line computed here for a same-month collection, else the stored one,
 * else the rule of the collection day). Lines are ordered by day.
 */
export function computeLines(input: ComputeInput): { lines: LineDraft[]; totals: StatementTotals } {
  const lines: LineDraft[] = [];
  const byPayment = new Map<string, LineDraft>();
  for (const c of input.collections) {
    const rule = ruleFor(input.rules, "collection_percent", c.businessDate, c.taxRuleId);
    const line: LineDraft = {
      kind: "collection",
      ruleId: rule?.id ?? null,
      paymentId: c.paymentId,
      taxpayerId: null,
      businessDate: c.businessDate,
      baseFc: c.amountFc,
      rateBp: rule?.rateBp ?? 0,
      amountFc: rule ? commissionAmount(c.amountFc, rule.rateBp) : 0,
    };
    lines.push(line);
    byPayment.set(c.paymentId, line);
  }
  for (const r of input.reversals) {
    const earned = byPayment.get(r.paymentId) ?? r.priorLine;
    let ruleId: string | null;
    let rateBp: number;
    let amountFc: number;
    if (earned) {
      ruleId = earned.ruleId;
      rateBp = earned.rateBp;
      amountFc = earned.amountFc;
    } else {
      const rule = ruleFor(input.rules, "collection_percent", r.collectedOn, r.taxRuleId);
      ruleId = rule?.id ?? null;
      rateBp = rule?.rateBp ?? 0;
      amountFc = rule ? commissionAmount(r.amountFc, rule.rateBp) : 0;
    }
    lines.push({
      kind: "reversal",
      ruleId,
      paymentId: r.paymentId,
      taxpayerId: null,
      businessDate: r.businessDate,
      baseFc: r.amountFc,
      rateBp,
      amountFc: -amountFc,
    });
  }
  // DECISION-PENDING: D36 — every household registered by the agent earns the fixed amount.
  for (const g of input.registrations) {
    const rule = ruleFor(input.rules, "registration_fixed", g.businessDate, null);
    lines.push({
      kind: "registration",
      ruleId: rule?.id ?? null,
      paymentId: null,
      taxpayerId: g.taxpayerId,
      businessDate: g.businessDate,
      baseFc: 0,
      rateBp: 0,
      amountFc: rule?.amountFc ?? 0,
    });
  }
  lines.sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  return { lines, totals: totalsOf(lines) };
}

export interface ComputedStatement {
  agentId: string;
  period: string;
  computedAt: Date;
  totals: StatementTotals;
  lines: LineDraft[];
}

const singleTax = (ids: string[] | null) => (ids && ids.length === 1 && ids[0] ? ids[0] : null);

/**
 * One agent, one month, straight from the ledger (no writes): confirmed collections the agent
 * initiated (`payments.business_date`), reversals dated by `reversed_at`, households registered
 * by the agent (`taxpayers.registered_at`), each at the rule effective on its business day.
 */
export async function computeStatement(
  db: Db | Tx,
  agentId: string,
  period: string,
  now = new Date(),
): Promise<ComputedStatement> {
  const { start, end } = periodRange(period);
  const rules = await db.select().from(commissionRules);
  // The outer table is named in full: drizzle prints `${payments.id}` unqualified here, which is
  // ambiguous inside the correlated subquery.
  const taxIdsOf = sql<string[] | null>`array(
    select distinct o.tax_rule_id::text from app.payment_allocations pa
    join app.obligations o on o.id = pa.obligation_id
    where pa.payment_id = app.payments.id)`;
  const collected = await db
    .select({
      id: payments.id,
      businessDate: payments.businessDate,
      amountFc: payments.amountFc,
      taxRuleIds: taxIdsOf,
    })
    .from(payments)
    .where(
      and(
        eq(payments.initiatedByAgentId, agentId),
        isNotNull(payments.confirmedAt),
        inArray(payments.status, ["confirmed", "reversed"]),
        gte(payments.businessDate, start),
        lte(payments.businessDate, end),
      ),
    );
  const reversedOn = sql<string>`util.business_date(${payments.reversedAt})::text`;
  const reversed = await db
    .select({
      id: payments.id,
      collectedOn: payments.businessDate,
      reversedOn,
      amountFc: payments.amountFc,
      taxRuleIds: taxIdsOf,
    })
    .from(payments)
    .where(
      and(
        eq(payments.initiatedByAgentId, agentId),
        eq(payments.status, "reversed"),
        isNotNull(payments.reversedAt),
        sql`util.business_date(${payments.reversedAt}) between ${start}::date and ${end}::date`,
      ),
    );
  const priorLines = reversed.length
    ? await db
        .select({
          paymentId: commissionLines.paymentId,
          ruleId: commissionLines.ruleId,
          baseFc: commissionLines.baseFc,
          rateBp: commissionLines.rateBp,
          amountFc: commissionLines.amountFc,
          status: commissionStatements.status,
        })
        .from(commissionLines)
        .innerJoin(commissionStatements, eq(commissionStatements.id, commissionLines.statementId))
        .where(
          and(
            eq(commissionLines.kind, "collection"),
            inArray(
              commissionLines.paymentId,
              reversed.map((r) => r.id),
            ),
          ),
        )
    : [];
  const rank = { paid: 0, approved: 1, draft: 2 } as const;
  const priorOf = (paymentId: string) =>
    priorLines
      .filter((l) => l.paymentId === paymentId)
      .sort((a, b) => rank[a.status] - rank[b.status])[0] ?? null;
  const registeredOn = sql<string>`util.business_date(${taxpayers.registeredAt})::text`;
  const registered = await db
    .select({ id: taxpayers.id, businessDate: registeredOn })
    .from(taxpayers)
    .where(
      and(
        eq(taxpayers.registeredByAgentId, agentId),
        sql`util.business_date(${taxpayers.registeredAt}) between ${start}::date and ${end}::date`,
      ),
    );
  const { lines, totals } = computeLines({
    rules,
    collections: collected.map((p) => ({
      paymentId: p.id,
      businessDate: p.businessDate!,
      amountFc: p.amountFc,
      taxRuleId: singleTax(p.taxRuleIds),
    })),
    reversals: reversed.map((p) => {
      const prior = priorOf(p.id);
      return {
        paymentId: p.id,
        businessDate: p.reversedOn,
        collectedOn: p.collectedOn!,
        amountFc: p.amountFc,
        taxRuleId: singleTax(p.taxRuleIds),
        priorLine: prior
          ? {
              ruleId: prior.ruleId,
              baseFc: prior.baseFc,
              rateBp: prior.rateBp,
              amountFc: prior.amountFc,
            }
          : null,
      };
    }),
    registrations: registered.map((r) => ({ taxpayerId: r.id, businessDate: r.businessDate })),
  });
  return { agentId, period, computedAt: now, totals, lines };
}
