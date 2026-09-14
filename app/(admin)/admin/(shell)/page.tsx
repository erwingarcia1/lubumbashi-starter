import Link from "next/link";
import { asc, eq } from "drizzle-orm";

import { overview } from "@/lib/admin/stats";
import { getDb } from "@/lib/db/client";
import { taxRules, zones } from "@/lib/db/schema";
import { formatFC } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { businessClock, requestNow } from "@/lib/time";

import { Pill } from "../_components/pill";

const monthLabel = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Lubumbashi",
  month: "long",
  year: "numeric",
});

function shortFc(n: number): string {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M FC`;
  return formatFC(n);
}

/** d-over: the mayor's screen. */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string; commune?: string; taxe?: string }>;
}) {
  const sp = await searchParams;
  const now = requestNow();
  const c = businessClock(now);
  const month =
    sp.mois && /^\d{4}-\d{2}$/.test(sp.mois)
      ? sp.mois
      : `${c.year}-${String(c.month).padStart(2, "0")}`;
  const db = getDb();
  const [communes, taxes, data] = await Promise.all([
    db
      .select({ code: zones.code, name: zones.name })
      .from(zones)
      .where(eq(zones.level, "commune"))
      .orderBy(asc(zones.name)),
    db.selectDistinct({ taxCode: taxRules.taxCode, labelFr: taxRules.labelFr }).from(taxRules),
    overview(
      db,
      { month, communeCode: sp.commune || undefined, taxCode: sp.taxe || undefined },
      now,
    ),
  ]);
  const O = t.admin.overview;
  const max = Math.max(1, ...data.daily.map((d) => d.amountFc));
  const kpis = [
    [O.registered, String(data.registered), `+${data.registeredThisWeek} ${O.thisWeek}`, "up"],
    [O.issued, shortFc(data.issuedFc), `${data.obligationCount} ${O.obligations}`, ""],
    [
      O.collected,
      shortFc(data.collectedFc),
      `${data.collectedFc - data.collectedPreviousMonthFc >= 0 ? "+" : ""}${shortFc(Math.abs(data.collectedFc - data.collectedPreviousMonthFc))} ${O.vsPrevious}`,
      data.collectedFc >= data.collectedPreviousMonthFc ? "up" : "dn",
    ],
    [O.rate, `${data.rate} %`, "", "up"],
    [O.unpaid, shortFc(data.unpaidFc), `${data.unpaidTaxpayers} ${O.taxpayers}`, "dn"],
  ] as const;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">{O.title}</h2>
        <form
          method="get"
          className="flex w-full flex-wrap gap-1.5 text-base md:ml-auto md:w-auto md:text-[12px]"
        >
          <input
            type="month"
            name="mois"
            defaultValue={month}
            className="h-11 min-w-0 grow rounded-md border border-[#D5CFCF] bg-white px-2 md:h-8 md:grow-0"
          />
          <select
            name="commune"
            defaultValue={sp.commune ?? ""}
            className="h-11 min-w-0 grow rounded-md border border-[#D5CFCF] bg-white px-2 md:h-8 md:grow-0"
          >
            <option value="">
              {O.commune} : {t.common.all}
            </option>
            {communes.map((z) => (
              <option key={z.code} value={z.code}>
                {z.name}
              </option>
            ))}
          </select>
          <select
            name="taxe"
            defaultValue={sp.taxe ?? ""}
            className="h-11 min-w-0 grow rounded-md border border-[#D5CFCF] bg-white px-2 md:h-8 md:grow-0"
          >
            <option value="">
              {O.tax} : {t.common.all}
            </option>
            {taxes.map((x) => (
              <option key={x.taxCode} value={x.taxCode}>
                {x.labelFr}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="h-11 grow rounded-md border border-[#D5CFCF] bg-white px-3 font-semibold md:h-8 md:grow-0"
          >
            {t.common.search}
          </button>
        </form>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
        {kpis.map(([l, v, d, tone]) => (
          <div key={l} className="min-w-0 rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3">
            <div className="text-[11.5px] font-semibold tracking-wide break-words text-[#5C5456] uppercase">
              {l}
            </div>
            <div className="mt-0.5 text-[22px] font-bold tracking-tight tabular-nums">{v}</div>
            {d ? (
              <div
                className={`text-[11.5px] ${tone === "up" ? "text-ok" : tone === "dn" ? "text-bad" : "text-[#5C5456]"}`}
              >
                {d}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0 rounded-lg border border-[#E3DEDE] bg-white p-3.5">
          <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">{O.daily}</p>
          <div
            className="mt-2.5 flex h-[130px] items-end gap-1.5 border-b border-[#E3DEDE] pb-1"
            data-testid="daily-chart"
          >
            {data.daily.map((d, i) => (
              <div
                key={d.day}
                title={`${d.day} · ${formatFC(d.amountFc)}`}
                className={`flex-1 rounded-t-sm ${i === data.daily.length - 1 ? "bg-[#8B0F1A]" : "bg-[#C1121F]"}`}
                style={{ height: `${Math.max(2, Math.round((d.amountFc / max) * 100))}%` }}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[12.5px] text-[#5C5456]">
            <span>{data.daily[0]?.day.slice(5).split("-").reverse().join("/")}</span>
            <span>{data.daily.at(-1)?.day.slice(5).split("-").reverse().join("/")}</span>
          </div>
        </div>
        <div className="min-w-0 rounded-lg border border-[#E3DEDE] bg-white p-3.5">
          <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
            {O.byChannel} · {monthLabel.format(new Date(`${month}-15T12:00:00+02:00`))}
          </p>
          <div className="mt-2.5 flex flex-col gap-1.5">
            {data.byChannel.length === 0 ? (
              <p className="text-[12.5px] text-[#5C5456]">{O.noPayments}</p>
            ) : null}
            {data.byChannel.map((ch) => (
              <div
                key={ch.key}
                className="grid grid-cols-[110px_minmax(0,1fr)_60px] items-center gap-2 text-[12.5px]"
              >
                <span className="break-words">
                  {t.status.channel[ch.key as keyof typeof t.status.channel] ?? ch.key}
                </span>
                <div className="h-2.5 min-w-0 overflow-hidden rounded-sm bg-[#EFEAEA]">
                  <div className="h-full bg-[#C1121F]" style={{ width: `${ch.pct}%` }} />
                </div>
                <span className="text-right font-mono tabular-nums">{ch.pct} %</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
            {O.alerts}
          </p>
          <div className="mt-1 text-[12.5px]">
            {[
              [
                data.alerts.reconciliationExceptions,
                O.alertExceptions,
                "/admin/bientot/reconciliation",
                "bad",
              ],
              [data.alerts.abnormalAgents, O.alertAgents, "/admin/agents", "warn"],
              [data.alerts.probableDuplicates, O.alertDuplicates, "/admin/contribuables", "n"],
            ].map(([n, label, href, tone]) => (
              <Link
                key={String(label)}
                href={String(href) as never}
                className="flex min-h-11 items-center gap-2.5 border-b border-[#EFEAEA] py-2.5 last:border-0 md:min-h-0"
              >
                <Pill tone={tone as "bad" | "warn" | "n"}>{String(n)}</Pill>
                <span>{String(label)}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
