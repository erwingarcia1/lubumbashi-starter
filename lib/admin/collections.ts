import { sql } from "drizzle-orm";

import type { Db } from "@/lib/db/client";

import { collectionRate } from "./stats";

export interface CollectionFilters {
  from: string; // YYYY-MM-DD business dates, inclusive
  to: string;
  communeCode?: string;
  taxCode?: string;
  channel?: string;
  agentMatricule?: string;
}

export interface CollectionRow {
  at: Date;
  reference: string;
  receiptNo: string | null;
  taxpayerNo: string;
  taxpayerName: string;
  taxLabel: string;
  channel: string;
  origin: string;
  agentMatricule: string | null;
  amountFc: number;
  status: string;
}

/** The finance view (d-coll): by commune, by tax, then every confirmed or failed attempt. */
export async function collectionsReport(db: Db, f: CollectionFilters) {
  const commune = f.communeCode ?? null;
  const tax = f.taxCode ?? null;
  const channel = f.channel ?? null;
  const agent = f.agentMatricule ?? null;
  const byCommune = (
    await db.execute<{ commune: string; issued: number; collected: number }>(sql`
      select z.name as commune,
             coalesce(sum(o.amount_fc + o.penalty_fc) filter (where o.status not in ('waived','cancelled') and o.period_start <= ${f.to}::date), 0)::int as issued,
             coalesce(sum(o.paid_fc) filter (where o.period_start <= ${f.to}::date), 0)::int as collected
      from app.zones z
      left join app.taxpayers t on t.commune_id = z.id and t.status = 'active'
      left join app.obligations o on o.taxpayer_id = t.id
      where z.level = 'commune'
      group by z.name order by collected desc, z.name`)
  ).rows.map((r) => ({
    commune: r.commune,
    issuedFc: Number(r.issued),
    collectedFc: Number(r.collected),
    rate: collectionRate(Number(r.collected), Number(r.issued)),
  }));
  const byTax = (
    await db.execute<{
      tax: string;
      label: string;
      category: string;
      issued: number;
      collected: number;
    }>(sql`
      select r.tax_code as tax, r.label_fr as label, c.label_fr as category,
             coalesce(sum(o.amount_fc + o.penalty_fc) filter (where o.status not in ('waived','cancelled')), 0)::int as issued,
             coalesce(sum(o.paid_fc), 0)::int as collected
      from app.tax_rules r join app.categories c on c.id = r.category_id
      left join app.obligations o on o.tax_rule_id = r.id and o.period_start <= ${f.to}::date
      where r.active
      group by r.tax_code, r.label_fr, c.label_fr, c.sort_order order by r.tax_code, c.sort_order`)
  ).rows.map((r) => ({
    taxCode: r.tax,
    label: `${r.label} · ${r.category}`,
    issuedFc: Number(r.issued),
    collectedFc: Number(r.collected),
    rate: collectionRate(Number(r.collected), Number(r.issued)),
  }));
  const rows = (
    await db.execute<{
      at: Date;
      reference: string;
      receipt_no: string | null;
      taxpayer_no: string;
      name: string;
      tax_label: string;
      channel: string;
      origin: string;
      matricule: string | null;
      amount: number;
      status: string;
    }>(sql`
      select coalesce(p.confirmed_at, p.failed_at, p.created_at) as at, p.reference, rc.receipt_no, t.taxpayer_no, t.full_name as name,
             coalesce((select string_agg(distinct r.label_fr, ' + ') from app.payment_allocations a join app.obligations o on o.id = a.obligation_id join app.tax_rules r on r.id = o.tax_rule_id where a.payment_id = p.id), '—') as tax_label,
             p.channel::text as channel, p.origin::text as origin, ag.matricule, p.amount_fc as amount, p.status::text as status
      from app.payments p
      join app.taxpayers t on t.id = p.taxpayer_id join app.zones z on z.id = t.commune_id
      left join app.receipts rc on rc.payment_id = p.id
      left join app.agents ag on ag.id = p.initiated_by_agent_id
      where p.status in ('confirmed','failed','reversed')
        and p.business_date between ${f.from}::date and ${f.to}::date
        and (${commune}::text is null or z.code = ${commune})
        and (${channel}::text is null or p.channel::text = ${channel})
        and (${agent}::text is null or ag.matricule = ${agent})
        and (${tax}::text is null or exists (select 1 from app.payment_allocations a join app.obligations o on o.id = a.obligation_id join app.tax_rules r on r.id = o.tax_rule_id where a.payment_id = p.id and r.tax_code = ${tax}))
      order by at desc limit 200`)
  ).rows.map<CollectionRow>((r) => ({
    at: new Date(r.at),
    reference: r.reference,
    receiptNo: r.receipt_no,
    taxpayerNo: r.taxpayer_no,
    taxpayerName: r.name,
    taxLabel: r.tax_label,
    channel: r.channel,
    origin: r.origin,
    agentMatricule: r.matricule,
    amountFc: Number(r.amount),
    status: r.status,
  }));
  return { byCommune, byTax, rows };
}
