import { z } from "zod";

import { agentsTable } from "@/lib/admin/agents";
import { auditCsv, auditJournal, type AuditFilters } from "@/lib/admin/audit";
import { collectionsReport } from "@/lib/admin/collections";
import type { Db } from "@/lib/db/client";
import { formatDateFr, formatDateTimeFr, formatFC, formatMonthFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { availableChannels } from "@/lib/payments/registry";
import { closeHistory } from "@/lib/reconciliation/actions";
import { reconciliationDay } from "@/lib/reconciliation/view";
import { businessDate, monthPeriodOf } from "@/lib/time";

import { sql } from "drizzle-orm";

import { tablePdf, type PdfSection } from "./pdf";
import { workbook } from "./xlsx";

/** The six reports of the prototype (d-reports). Adding one is a registry entry, not a screen. */
export const REPORT_CODES = [
  "monthly",
  "unpaid",
  "agents",
  "reconciliation",
  "audit",
  "receipts",
] as const;
export type ReportCode = (typeof REPORT_CODES)[number];
export type ReportFormat = "xlsx" | "pdf" | "csv";

export const REPORTS: Record<
  ReportCode,
  { formats: ReportFormat[]; param: "month" | "day" | "none" }
> = {
  monthly: { formats: ["pdf", "xlsx"], param: "month" },
  unpaid: { formats: ["xlsx"], param: "none" },
  agents: { formats: ["pdf"], param: "none" },
  reconciliation: { formats: ["pdf"], param: "day" },
  audit: { formats: ["csv"], param: "none" },
  receipts: { formats: ["xlsx"], param: "month" },
};

export const reportParams = z.object({
  format: z.enum(["xlsx", "pdf", "csv"]),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  actor: z.string().max(80).optional(),
  action: z.string().max(80).optional(),
  object: z.string().max(80).optional(),
});
export type ReportParams = z.infer<typeof reportParams>;

export interface ReportFile {
  filename: string;
  contentType: string;
  body: Buffer;
  rows: number;
}

const TYPES: Record<ReportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
};

function monthOf(p: ReportParams, now: Date) {
  const [y, m] = (p.month ?? businessDate(now).slice(0, 7)).split("-").map(Number) as [
    number,
    number,
  ];
  return {
    year: y,
    month: m,
    period: monthPeriodOf(y, m),
    label: formatMonthFr(`${p.month ?? businessDate(now).slice(0, 7)}-01`),
  };
}

const CH = (c: string) => t.status.channel[c as keyof typeof t.status.channel] ?? c;

export async function buildReport(
  db: Db,
  code: ReportCode,
  raw: ReportParams,
  now = new Date(),
): Promise<ReportFile> {
  const p = reportParams.parse(raw);
  const def = REPORTS[code];
  if (!def.formats.includes(p.format))
    throw new Error(`format ${p.format} not available for ${code}`);
  const L = t.admin.reports.items[code].label;
  const R = t.admin.reports;

  switch (code) {
    case "monthly": {
      const m = monthOf(p, now);
      const data = await collectionsReport(db, { from: m.period.start, to: m.period.end });
      const byChannel = new Map<string, { count: number; amountFc: number }>();
      for (const r of data.rows.filter((x) => x.status === "confirmed")) {
        const e = byChannel.get(r.channel) ?? { count: 0, amountFc: 0 };
        e.count += 1;
        e.amountFc += r.amountFc;
        byChannel.set(r.channel, e);
      }
      const channelRows = [...byChannel.entries()].map(([channel, v]) => ({
        channel: CH(channel),
        count: v.count,
        amountFc: v.amountFc,
      }));
      if (p.format === "xlsx") {
        const rows = [
          ...data.byCommune.map((r) => ({
            section: t.admin.collections.byCommune,
            label: r.commune,
            issuedFc: r.issuedFc,
            collectedFc: r.collectedFc,
            rate: r.rate,
          })),
          ...data.byTax.map((r) => ({
            section: t.admin.collections.byTax,
            label: r.label,
            issuedFc: r.issuedFc,
            collectedFc: r.collectedFc,
            rate: r.rate,
          })),
          ...channelRows.map((r) => ({
            section: t.admin.overview.byChannel,
            label: r.channel,
            issuedFc: null,
            collectedFc: r.amountFc,
            rate: null,
          })),
        ];
        return {
          filename: `rapport-mensuel-${p.month ?? businessDate(now).slice(0, 7)}.xlsx`,
          contentType: TYPES.xlsx,
          rows: rows.length,
          body: await workbook(
            L,
            [
              { header: R.columns.section, key: "section", width: 18 },
              { header: R.columns.label, key: "label", width: 36 },
              { header: R.columns.issued, key: "issuedFc", money: true, width: 16 },
              { header: R.columns.collected, key: "collectedFc", money: true, width: 16 },
              { header: R.columns.rate, key: "rate", width: 10 },
            ],
            rows,
            m.label,
          ),
        };
      }
      const sections: PdfSection[] = [
        {
          title: t.admin.collections.byCommune,
          columns: [
            { header: R.columns.label, key: "label", width: 3 },
            { header: R.columns.issued, key: "issued", align: "right" },
            { header: R.columns.collected, key: "collected", align: "right" },
            { header: R.columns.rate, key: "rate", align: "right" },
          ],
          rows: data.byCommune.map((r) => ({
            label: r.commune,
            issued: formatFC(r.issuedFc),
            collected: formatFC(r.collectedFc),
            rate: `${r.rate} %`,
          })),
        },
        {
          title: t.admin.collections.byTax,
          columns: [
            { header: R.columns.label, key: "label", width: 3 },
            { header: R.columns.issued, key: "issued", align: "right" },
            { header: R.columns.collected, key: "collected", align: "right" },
            { header: R.columns.rate, key: "rate", align: "right" },
          ],
          rows: data.byTax.map((r) => ({
            label: r.label,
            issued: formatFC(r.issuedFc),
            collected: formatFC(r.collectedFc),
            rate: `${r.rate} %`,
          })),
        },
        {
          title: t.admin.overview.byChannel,
          columns: [
            { header: R.columns.label, key: "label", width: 3 },
            { header: R.columns.count, key: "count", align: "right" },
            { header: R.columns.collected, key: "collected", align: "right" },
          ],
          rows: channelRows.map((r) => ({
            label: r.channel,
            count: r.count,
            collected: formatFC(r.amountFc),
          })),
          total: {
            label: t.common.all,
            count: channelRows.reduce((s, r) => s + r.count, 0),
            collected: formatFC(channelRows.reduce((s, r) => s + r.amountFc, 0)),
          },
        },
      ];
      return {
        filename: `rapport-mensuel-${p.month ?? businessDate(now).slice(0, 7)}.pdf`,
        contentType: TYPES.pdf,
        rows: data.byCommune.length + data.byTax.length + channelRows.length,
        body: await tablePdf(L, m.label, sections, now),
      };
    }
    case "unpaid": {
      const today = businessDate(now);
      const rows = (
        await db.execute<{
          taxpayer_no: string;
          full_name: string;
          phone: string;
          commune: string;
          quartier: string | null;
          category: string | null;
          outstanding: number;
          late: number;
          oldest_due: string | null;
        }>(sql`
          select t.taxpayer_no, t.full_name, t.phone,
                 (select name from app.zones z where z.id = t.commune_id) as commune,
                 (select name from app.zones z where z.id = t.quartier_id) as quartier,
                 (select c.label_fr from app.entities e join app.categories c on c.id = e.category_id where e.taxpayer_id = t.id order by e.created_at limit 1) as category,
                 sum(o.amount_fc + o.penalty_fc - o.paid_fc)::int as outstanding,
                 coalesce(sum(o.amount_fc + o.penalty_fc - o.paid_fc) filter (where o.due_date < ${today}::date), 0)::int as late,
                 min(o.due_date) filter (where o.due_date < ${today}::date)::text as oldest_due
          from app.taxpayers t
          join app.obligations o on o.taxpayer_id = t.id and o.status in ('due','partially_paid')
          where t.status = 'active'
          group by t.id
          having sum(o.amount_fc + o.penalty_fc - o.paid_fc) > 0
          order by late desc, outstanding desc, t.taxpayer_no`)
      ).rows.map((r) => ({
        taxpayerNo: r.taxpayer_no,
        fullName: r.full_name,
        phone: r.phone,
        commune: r.commune,
        quartier: r.quartier,
        category: r.category,
        outstandingFc: Number(r.outstanding),
        lateFc: Number(r.late),
        lateSince: r.oldest_due ? formatDateFr(r.oldest_due) : null,
      }));
      return {
        filename: `impayes-${today}.xlsx`,
        contentType: TYPES.xlsx,
        rows: rows.length,
        body: await workbook(
          L,
          [
            { header: R.columns.taxpayerNo, key: "taxpayerNo", width: 20 },
            { header: R.columns.name, key: "fullName", width: 30 },
            { header: R.columns.phone, key: "phone", width: 16 },
            { header: R.columns.commune, key: "commune", width: 14 },
            { header: R.columns.quartier, key: "quartier", width: 14 },
            { header: R.columns.category, key: "category", width: 14 },
            { header: R.columns.outstanding, key: "outstandingFc", money: true, width: 16 },
            { header: R.columns.late, key: "lateFc", money: true, width: 16 },
            { header: R.columns.lateSince, key: "lateSince", width: 14 },
          ],
          rows,
          `${R.asOf} ${formatDateFr(today)}`,
        ),
      };
    }
    case "agents": {
      const rows = await agentsTable(db, now);
      return {
        filename: `agents-${businessDate(now)}.pdf`,
        contentType: TYPES.pdf,
        rows: rows.length,
        body: await tablePdf(
          L,
          `${R.asOf} ${formatDateFr(businessDate(now))}`,
          [
            {
              title: t.admin.agents.title,
              columns: [
                { header: t.admin.agents.columns.agent, key: "agent", width: 3 },
                { header: t.admin.agents.columns.zone, key: "zone", width: 2 },
                { header: t.admin.agents.columns.registered, key: "registered", align: "right" },
                { header: t.admin.agents.columns.collections, key: "collections", align: "right" },
                { header: t.admin.agents.columns.amount, key: "amount", align: "right", width: 2 },
                { header: t.admin.agents.columns.failure, key: "failure", align: "right" },
                { header: t.admin.agents.columns.duplicates, key: "duplicates", align: "right" },
                { header: t.admin.agents.columns.status, key: "status" },
              ],
              rows: rows.map((r) => ({
                agent: `${r.matricule} · ${r.fullName}`,
                zone: r.zone,
                registered: r.registered,
                collections: r.collections,
                amount: formatFC(r.amountFc),
                failure: r.failureRate7d === null ? "—" : `${r.failureRate7d} %`,
                duplicates: r.duplicates,
                status:
                  r.status === "active"
                    ? t.admin.agents.statuses.ok
                    : t.admin.agents.statuses.suspended,
              })),
            },
          ],
          now,
        ),
      };
    }
    case "reconciliation": {
      const day = p.day ?? businessDate(new Date(now.getTime() - 86_400_000));
      const view = await reconciliationDay(db, day, availableChannels());
      const closes = await closeHistory(db, 10);
      const RC = t.admin.reconciliation;
      return {
        filename: `rapprochement-${day}.pdf`,
        contentType: TYPES.pdf,
        rows: view.exceptions.length,
        body: await tablePdf(
          L,
          formatDateFr(day),
          [
            {
              title: RC.kpi.platform,
              columns: [
                { header: RC.columns.provider, key: "provider", width: 2 },
                { header: RC.kpi.platform, key: "platform", align: "right" },
                { header: RC.kpi.statement, key: "statement", align: "right" },
                { header: RC.kpi.matched, key: "matched", align: "right" },
                { header: RC.kpi.exceptions, key: "exceptions", align: "right" },
              ],
              rows: view.runs.map(({ provider, run }) => ({
                provider: CH(provider),
                platform: run
                  ? `${run.platformCount} · ${formatFC(run.platformTotalFc)}`
                  : RC.notRun,
                statement: run ? `${run.statementCount} · ${formatFC(run.statementTotalFc)}` : "",
                matched: run?.matchedCount ?? "",
                exceptions: run?.exceptionCount ?? "",
              })),
            },
            {
              title: RC.kpi.exceptions,
              columns: [
                { header: RC.columns.type, key: "type", width: 2 },
                { header: RC.columns.reference, key: "reference", width: 3 },
                { header: RC.columns.provider, key: "provider" },
                { header: RC.columns.platform, key: "platform", align: "right" },
                { header: RC.columns.statement, key: "statement", align: "right" },
                { header: RC.columns.taxpayer, key: "taxpayer", width: 2 },
                { header: RC.columns.action, key: "resolution", width: 3 },
              ],
              rows: view.exceptions.map((e) => ({
                type: RC.types[e.type],
                reference: e.platformReference ?? e.providerReference ?? "",
                provider: CH(e.provider),
                platform: e.platformAmountFc === null ? "—" : formatFC(e.platformAmountFc),
                statement: e.statementAmountFc === null ? "—" : formatFC(e.statementAmountFc),
                taxpayer: e.taxpayerNo ?? RC.unknownPayer,
                resolution: e.status === "resolved" ? (e.resolution ?? RC.resolved) : "",
              })),
            },
            {
              title: RC.history,
              columns: [
                { header: RC.day, key: "day" },
                { header: RC.close, key: "closedAt", width: 2 },
                { header: RC.transactions, key: "count", align: "right" },
                { header: R.columns.collected, key: "total", align: "right" },
                { header: RC.kpi.exceptions, key: "resolved", align: "right" },
              ],
              rows: closes.map((h) => ({
                day: formatDateFr(h.businessDate),
                closedAt: `${formatDateTimeFr(h.closedAt)}${h.closedBy ? ` · ${h.closedBy}` : ""}`,
                count: h.transactionCount,
                total: formatFC(h.totalFc),
                resolved: h.resolved,
              })),
            },
          ],
          now,
        ),
      };
    }
    case "audit": {
      const f: AuditFilters = {
        from: p.from,
        to: p.to,
        actor: p.actor,
        action: p.action,
        object: p.object,
        limit: 5000,
      };
      const { rows } = await auditJournal(db, f);
      return {
        filename: `journal-audit-${businessDate(now)}.csv`,
        contentType: TYPES.csv,
        rows: rows.length,
        body: Buffer.from(auditCsv(rows), "utf8"),
      };
    }
    case "receipts": {
      const m = monthOf(p, now);
      const rows = (
        await db.execute<{
          receipt_no: string;
          issued_at: Date;
          taxpayer_no: string;
          full_name: string;
          amount_fc: number;
          channel: string;
          origin: string;
          reference: string;
          provider_reference: string | null;
          agent: string | null;
          status: string;
        }>(sql`
          select r.receipt_no, r.issued_at, t.taxpayer_no, t.full_name, r.amount_fc, p.channel, p.origin, p.reference,
                 pc.provider_reference, a.matricule as agent, r.status
          from app.receipts r
          join app.payments p on p.id = r.payment_id
          join app.taxpayers t on t.id = r.taxpayer_id
          left join app.provider_confirmations pc on pc.payment_id = p.id
          left join app.agents a on a.id = p.initiated_by_agent_id
          where util.business_date(r.issued_at) between ${m.period.start}::date and ${m.period.end}::date
          order by r.receipt_no`)
      ).rows.map((r) => ({
        receiptNo: r.receipt_no,
        issuedAt: formatDateTimeFr(new Date(r.issued_at)),
        taxpayerNo: r.taxpayer_no,
        fullName: r.full_name,
        amountFc: Number(r.amount_fc),
        channel: CH(r.channel),
        origin: t.status.origin[r.origin as keyof typeof t.status.origin] ?? r.origin,
        reference: r.reference,
        providerReference: r.provider_reference,
        agent: r.agent,
        status: r.status === "cancelled" ? t.status.receipt.cancelled : t.status.receipt.issued,
      }));
      return {
        filename: `recus-${p.month ?? businessDate(now).slice(0, 7)}.xlsx`,
        contentType: TYPES.xlsx,
        rows: rows.length,
        body: await workbook(
          L,
          [
            { header: t.receipt.number, key: "receiptNo", width: 18 },
            { header: t.receipt.date, key: "issuedAt", width: 14 },
            { header: R.columns.taxpayerNo, key: "taxpayerNo", width: 20 },
            { header: R.columns.name, key: "fullName", width: 30 },
            { header: t.receipt.amount, key: "amountFc", money: true, width: 14 },
            { header: t.receipt.channel, key: "channel", width: 14 },
            { header: R.columns.origin, key: "origin", width: 10 },
            { header: R.columns.reference, key: "reference", width: 24 },
            { header: R.columns.providerReference, key: "providerReference", width: 22 },
            { header: t.receipt.agent, key: "agent", width: 12 },
            { header: t.admin.taxpayers.columns.status, key: "status", width: 10 },
          ],
          rows,
          m.label,
        ),
      };
    }
  }
}
