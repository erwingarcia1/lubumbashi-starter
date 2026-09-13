import { asc, eq } from "drizzle-orm";

import { collectionsReport } from "@/lib/admin/collections";
import { getDb } from "@/lib/db/client";
import { agents, taxRules, zones } from "@/lib/db/schema";
import { formatDateTimeFr, formatFC } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { availableChannels } from "@/lib/payments/registry";
import { businessDate, requestNow } from "@/lib/time";

import { Pill } from "../../_components/pill";

/** d-coll: finance's working view. */
export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    du?: string;
    au?: string;
    commune?: string;
    taxe?: string;
    canal?: string;
    agent?: string;
  }>;
}) {
  const sp = await searchParams;
  const today = businessDate(requestNow());
  const from = sp.du && /^\d{4}-\d{2}-\d{2}$/.test(sp.du) ? sp.du : `${today.slice(0, 7)}-01`;
  const to = sp.au && /^\d{4}-\d{2}-\d{2}$/.test(sp.au) ? sp.au : today;
  const db = getDb();
  const [communes, taxes, agentRows, report] = await Promise.all([
    db
      .select({ code: zones.code, name: zones.name })
      .from(zones)
      .where(eq(zones.level, "commune"))
      .orderBy(asc(zones.name)),
    db.selectDistinct({ taxCode: taxRules.taxCode, labelFr: taxRules.labelFr }).from(taxRules),
    db.select({ matricule: agents.matricule }).from(agents).orderBy(asc(agents.matricule)),
    collectionsReport(db, {
      from,
      to,
      communeCode: sp.commune || undefined,
      taxCode: sp.taxe || undefined,
      channel: sp.canal || undefined,
      agentMatricule: sp.agent || undefined,
    }),
  ]);
  const C = t.admin.collections;
  const sel = "h-8 rounded-md border border-[#D5CFCF] bg-white px-2";
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">{C.title}</h2>
        <form method="get" className="ml-auto flex flex-wrap items-center gap-1.5 text-[12px]">
          <label>
            {C.from} <input type="date" name="du" defaultValue={from} className={sel} />
          </label>
          <label>
            {C.to} <input type="date" name="au" defaultValue={to} className={sel} />
          </label>
          <select name="commune" defaultValue={sp.commune ?? ""} className={sel}>
            <option value="">
              {t.admin.overview.commune} : {t.common.all}
            </option>
            {communes.map((z) => (
              <option key={z.code} value={z.code}>
                {z.name}
              </option>
            ))}
          </select>
          <select name="taxe" defaultValue={sp.taxe ?? ""} className={sel}>
            <option value="">
              {t.admin.overview.tax} : {t.common.all}
            </option>
            {taxes.map((x) => (
              <option key={x.taxCode} value={x.taxCode}>
                {x.labelFr}
              </option>
            ))}
          </select>
          <select name="canal" defaultValue={sp.canal ?? ""} className={sel}>
            <option value="">
              {C.channel} : {t.common.all}
            </option>
            {availableChannels().map((ch) => (
              <option key={ch} value={ch}>
                {t.status.channel[ch]}
              </option>
            ))}
          </select>
          <select name="agent" defaultValue={sp.agent ?? ""} className={sel}>
            <option value="">
              {C.agent} : {t.common.all}
            </option>
            {agentRows.map((a) => (
              <option key={a.matricule} value={a.matricule}>
                {a.matricule}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="h-8 rounded-md border border-[#D5CFCF] bg-white px-3 font-semibold"
          >
            {C.apply}
          </button>
          <span
            className="h-8 rounded-md border border-[#D5CFCF] bg-white px-3 leading-8 text-[#8E8688]"
            title={C.exportSoon}
          >
            {C.exportExcel}
          </span>
        </form>
      </div>
      <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
        <div className="rounded-lg border border-[#E3DEDE] bg-white p-3.5">
          <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
            {C.byCommune}
          </p>
          <div className="mt-2.5 flex flex-col gap-1.5">
            {report.byCommune.map((r) => (
              <div
                key={r.commune}
                className="grid grid-cols-[110px_1fr_60px] items-center gap-2 text-[12.5px]"
              >
                <span>{r.commune}</span>
                <div className="h-2.5 overflow-hidden rounded-sm bg-[#EFEAEA]">
                  <div className="bg-ok h-full" style={{ width: `${Math.min(100, r.rate)}%` }} />
                </div>
                <span className="text-right font-mono tabular-nums">{r.rate} %</span>
              </div>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-[#E3DEDE] bg-white p-3.5">
          <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">{C.byTax}</p>
          <table className="mt-2 w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] tracking-wider text-[#5C5456] uppercase">
                <th className="border-b border-[#D5CFCF] px-2 py-1.5">{C.columns.tax}</th>
                <th className="border-b border-[#D5CFCF] px-2 py-1.5 text-right">
                  {C.columns.issued}
                </th>
                <th className="border-b border-[#D5CFCF] px-2 py-1.5 text-right">
                  {C.columns.collected}
                </th>
                <th className="border-b border-[#D5CFCF] px-2 py-1.5 text-right">
                  {C.columns.rate}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.byTax.map((r) => (
                <tr key={r.label} className="border-b border-[#EFEAEA]">
                  <td className="px-2 py-1.5">{r.label}</td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {r.issuedFc.toLocaleString("fr-FR")}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {r.collectedFc.toLocaleString("fr-FR")}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{r.rate} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[#E3DEDE] bg-white">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] tracking-wider text-[#5C5456] uppercase">
              {[
                C.columns.date,
                C.columns.receipt,
                C.columns.taxpayer,
                C.columns.tax,
                C.columns.channel,
                C.columns.agent,
              ].map((h) => (
                <th key={h} className="border-b border-[#D5CFCF] px-2.5 py-2 font-semibold">
                  {h}
                </th>
              ))}
              <th className="border-b border-[#D5CFCF] px-2.5 py-2 text-right font-semibold">
                {C.columns.amount}
              </th>
              <th className="border-b border-[#D5CFCF] px-2.5 py-2 font-semibold">
                {C.columns.status}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2.5 py-4 text-center text-[#5C5456]">
                  {C.empty}
                </td>
              </tr>
            ) : null}
            {report.rows.map((r) => (
              <tr key={r.reference} className="border-b border-[#EFEAEA]">
                <td className="px-2.5 py-2 font-mono">{formatDateTimeFr(r.at)}</td>
                <td className="px-2.5 py-2 font-mono">{r.receiptNo ?? t.common.none}</td>
                <td className="px-2.5 py-2">{r.taxpayerName}</td>
                <td className="px-2.5 py-2">{r.taxLabel}</td>
                <td className="px-2.5 py-2">
                  {t.status.channel[r.channel as keyof typeof t.status.channel] ?? r.channel}
                </td>
                <td className="px-2.5 py-2 font-mono">
                  {r.agentMatricule ?? (r.origin === "portal" ? C.portal : C.counter)}
                </td>
                <td className="px-2.5 py-2 text-right font-mono">{formatFC(r.amountFc)}</td>
                <td className="px-2.5 py-2">
                  <Pill tone={r.status === "confirmed" ? "ok" : "bad"}>
                    {t.status.payment[r.status as keyof typeof t.status.payment]}
                  </Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
