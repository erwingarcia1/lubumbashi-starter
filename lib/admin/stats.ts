import { sql } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import { businessDate } from "@/lib/time";

/** Pure KPI arithmetic (unit-tested). Rate is a whole percentage; shares sum to 100 or 0. */
export function collectionRate(collectedFc: number, issuedFc: number): number {
  return issuedFc > 0 ? Math.round((collectedFc / issuedFc) * 100) : 0;
}

export function shares(
  rows: Array<{ key: string; amountFc: number }>,
): Array<{ key: string; amountFc: number; pct: number }> {
  const total = rows.reduce((s, r) => s + r.amountFc, 0);
  return rows.map((r) => ({ ...r, pct: total > 0 ? Math.round((r.amountFc / total) * 100) : 0 }));
}

export interface OverviewFilters {
  /** YYYY-MM, business calendar. */
  month: string;
  communeCode?: string;
  taxCode?: string;
}

export interface Overview {
  month: string;
  registered: number;
  registeredThisWeek: number;
  issuedFc: number;
  obligationCount: number;
  collectedFc: number;
  collectedPreviousMonthFc: number;
  rate: number;
  unpaidFc: number;
  unpaidTaxpayers: number;
  daily: Array<{ day: string; amountFc: number }>;
  byChannel: Array<{ key: string; amountFc: number; pct: number }>;
  alerts: { reconciliationExceptions: number; abnormalAgents: number; probableDuplicates: number };
}

function monthBounds(month: string): { start: string; end: string; prevStart: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    start: `${y}-${pad(m)}-01`,
    end: `${y}-${pad(m)}-${pad(lastDay)}`,
    prevStart: `${prev.y}-${pad(prev.m)}-01`,
  };
}

/** The mayor's screen (d-over): every figure in integer FC, business days in Africa/Lubumbashi. */
export async function overview(db: Db, f: OverviewFilters, now = new Date()): Promise<Overview> {
  const { start, end, prevStart } = monthBounds(f.month);
  const today = businessDate(now);
  const commune = f.communeCode ?? null;
  const tax = f.taxCode ?? null;
  const communeFilter = sql`(${commune}::text is null or z.code = ${commune})`;
  const taxFilter = sql`(${tax}::text is null or r.tax_code = ${tax})`;

  const [reg] = (
    await db.execute<{ total: number; week: number }>(sql`
      select count(*)::int as total,
             count(*) filter (where t.registered_at >= (${today}::date - 7)::timestamptz)::int as week
      from app.taxpayers t join app.zones z on z.id = t.commune_id
      where t.status = 'active' and ${communeFilter}`)
  ).rows;
  const [issued] = (
    await db.execute<{ issued: number; n: number; unpaid: number; unpaid_taxpayers: number }>(sql`
      select coalesce(sum(o.amount_fc + o.penalty_fc), 0)::int as issued,
             count(*)::int as n,
             coalesce(sum(greatest(o.amount_fc + o.penalty_fc - o.paid_fc, 0)) filter (where o.status in ('due','partially_paid')), 0)::int as unpaid,
             count(distinct o.taxpayer_id) filter (where o.status in ('due','partially_paid'))::int as unpaid_taxpayers
      from app.obligations o
      join app.taxpayers t on t.id = o.taxpayer_id join app.zones z on z.id = t.commune_id
      join app.tax_rules r on r.id = o.tax_rule_id
      where o.period_start <= ${end}::date and o.status not in ('waived','cancelled') and ${communeFilter} and ${taxFilter}`)
  ).rows;
  const [collected] = (
    await db.execute<{ month: number; prev: number }>(sql`
      select coalesce(sum(p.amount_fc) filter (where p.business_date between ${start}::date and ${end}::date), 0)::int as month,
             coalesce(sum(p.amount_fc) filter (where p.business_date >= ${prevStart}::date and p.business_date < ${start}::date), 0)::int as prev
      from app.payments p join app.taxpayers t on t.id = p.taxpayer_id join app.zones z on z.id = t.commune_id
      where p.status = 'confirmed' and ${communeFilter}`)
  ).rows;
  const daily = (
    await db.execute<{ day: string; amount: number }>(sql`
      select d::date::text as day, coalesce(sum(p.amount_fc), 0)::int as amount
      from generate_series((${today}::date - 13), ${today}::date, interval '1 day') d
      left join app.payments p on p.business_date = d::date and p.status = 'confirmed'
      left join app.taxpayers t on t.id = p.taxpayer_id left join app.zones z on z.id = t.commune_id
      where p.id is null or ${communeFilter}
      group by d order by d`)
  ).rows;
  const channels = (
    await db.execute<{ channel: string; amount: number }>(sql`
      select p.channel::text as channel, sum(p.amount_fc)::int as amount
      from app.payments p join app.taxpayers t on t.id = p.taxpayer_id join app.zones z on z.id = t.commune_id
      where p.status = 'confirmed' and p.business_date between ${start}::date and ${end}::date and ${communeFilter}
      group by p.channel order by amount desc`)
  ).rows;
  const [alerts] = (
    await db.execute<{ exceptions: number; agents: number; duplicates: number }>(sql`
      select (select count(*) from app.reconciliation_exceptions where status = 'open')::int as exceptions,
             (select count(*) from (
                select p.initiated_by_agent_id,
                       count(*) filter (where p.status = 'failed')::float / nullif(count(*) filter (where p.status in ('failed','confirmed')), 0) as failure_rate,
                       count(*) filter (where p.status in ('failed','confirmed')) as attempts
                from app.payments p
                where p.initiated_by_agent_id is not null and p.business_date >= (${today}::date - 7)
                group by p.initiated_by_agent_id) a
              where a.attempts >= 5 and a.failure_rate > 0.3)::int as agents,
             (select count(*) from (
                select t.phone from app.taxpayers t where t.status = 'active' group by t.phone having count(*) > 1) d)::int as duplicates`)
  ).rows;
  return {
    month: f.month,
    registered: reg?.total ?? 0,
    registeredThisWeek: reg?.week ?? 0,
    issuedFc: issued?.issued ?? 0,
    obligationCount: issued?.n ?? 0,
    collectedFc: collected?.month ?? 0,
    collectedPreviousMonthFc: collected?.prev ?? 0,
    rate: collectionRate(collected?.month ?? 0, issued?.issued ?? 0),
    unpaidFc: issued?.unpaid ?? 0,
    unpaidTaxpayers: issued?.unpaid_taxpayers ?? 0,
    daily: daily.map((d) => ({ day: d.day, amountFc: Number(d.amount) })),
    byChannel: shares(channels.map((c) => ({ key: c.channel, amountFc: Number(c.amount) }))),
    alerts: {
      reconciliationExceptions: alerts?.exceptions ?? 0,
      abnormalAgents: alerts?.agents ?? 0,
      probableDuplicates: alerts?.duplicates ?? 0,
    },
  };
}
