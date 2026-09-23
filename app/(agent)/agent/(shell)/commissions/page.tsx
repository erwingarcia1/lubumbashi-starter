import Link from "next/link";

import { agentMonthView } from "@/lib/commissions/agent-view";
import { formatRateBp, formatSignedFC } from "@/lib/commissions/format";
import { isPeriod, periodOf } from "@/lib/commissions/period";
import { getDb } from "@/lib/db/client";
import { requireAgent } from "@/lib/identity/agent-session";
import { formatDateFr, formatFC, formatMonthFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { requestNow } from "@/lib/time";

import { AgentHeader } from "../../_components/header";
import { Pill } from "../../../../(admin)/admin/_components/pill";

const C = t.agent.commissions;
const tone = { draft: "n", approved: "warn", paid: "ok" } as const;
const dayFr = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Lubumbashi",
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "Mes commissions": what the agent earned this month (live) and the months already settled. */
export default async function AgentCommissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string }>;
}) {
  const [{ mois }, session] = await Promise.all([searchParams, requireAgent()]);
  const now = requestNow();
  const current = periodOf(now);
  const period = isPeriod(mois) ? mois : current;
  const view = await agentMonthView(getDb(), session.agentId, period, now);
  const label = formatMonthFr(`${period}-01`);
  const statusLine =
    view.status === "paid" && view.paidAt
      ? `${C.paidOn} ${formatDateFr(new Date(view.paidAt))}${view.paidReference ? ` · ${C.reference} ${view.paidReference}` : ""}`
      : null;

  return (
    <>
      <AgentHeader title={C.title} subtitle={`${session.matricule} · ${label}`} />
      <div className="flex flex-1 flex-col gap-3 px-4 py-3.5">
        <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
              {period === current ? C.thisMonth : label}
            </p>
            {view.status ? <Pill tone={tone[view.status]}>{C.statuses[view.status]}</Pill> : null}
          </div>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-[13.5px]">
            <dt className="text-[#5C5456]">{C.collections}</dt>
            <dd className="text-right font-mono">{view.totals.collectionsCount}</dd>
            <dt className="text-[#5C5456]">{C.collected}</dt>
            <dd className="text-right font-mono">{formatFC(view.totals.collectedFc)}</dd>
            <dt className="text-[#5C5456]">{C.commission}</dt>
            <dd className="text-right font-mono">
              {formatSignedFC(view.totals.collectionCommissionFc)}
            </dd>
            <dt className="text-[#5C5456]">{C.registrations}</dt>
            <dd className="text-right font-mono">{view.totals.registrationsCount}</dd>
            <dt className="text-[#5C5456]">{C.bonus}</dt>
            <dd className="text-right font-mono">
              {formatFC(view.totals.registrationCommissionFc)}
            </dd>
            <dt className="border-t border-[#EFEAEA] pt-2 text-[15px] font-bold">{C.total}</dt>
            <dd className="border-t border-[#EFEAEA] pt-2 text-right font-mono text-[20px] leading-tight font-bold">
              {formatSignedFC(view.totals.totalFc)}
            </dd>
          </dl>
          <p className="mt-2 text-[12px] text-[#5C5456]">
            {C.scale
              .replace("{rate}", formatRateBp(view.rates.collectionRateBp))
              .replace("{bonus}", formatFC(view.rates.registrationAmountFc))}
          </p>
          <p className="mt-1 text-[12px] text-[#5C5456]">
            {statusLine ?? (view.live ? C.live : C.frozen)}
          </p>
        </div>

        <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3">
          <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">{C.byDay}</p>
          {view.days.length === 0 ? (
            <p className="py-2 text-[12.5px] text-[#5C5456]">{C.noActivity}</p>
          ) : (
            <ul>
              {view.days.map((d) => (
                <li
                  key={d.date}
                  className="flex min-h-12 items-center gap-2.5 border-b border-[#EFEAEA] py-2 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold capitalize">
                      {dayFr.format(new Date(`${d.date}T12:00:00+02:00`))}
                    </div>
                    <div className="text-[12px] text-[#5C5456]">
                      {C.dayCollections.replace("{n}", String(d.collectionsCount))} ·{" "}
                      {formatFC(d.collectedFc)} ·{" "}
                      {C.dayRegistrations.replace("{n}", String(d.registrationsCount))}
                    </div>
                  </div>
                  <div className="font-mono text-[14px] font-bold whitespace-nowrap">
                    {formatSignedFC(d.totalFc)}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-[11.5px] text-[#8E8688]">{C.reversalsNote}</p>
          <p className="mt-1 text-[11.5px] text-[#8E8688]">{C.attributionNote}</p>
        </div>

        <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3">
          <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
            {C.previousMonths}
          </p>
          {view.months.length === 0 ? (
            <p className="py-2 text-[12.5px] text-[#5C5456]">{C.noPrevious}</p>
          ) : (
            <ul>
              {view.months.map((m) => (
                <li key={m.period}>
                  <Link
                    href={`/agent/commissions?mois=${m.period}` as never}
                    className="flex min-h-12 items-center gap-2.5 border-b border-[#EFEAEA] py-2 last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-semibold capitalize">
                        {formatMonthFr(`${m.period}-01`)}
                      </div>
                      <div className="text-[12px] text-[#5C5456]">
                        {m.status === "paid" && m.paidAt
                          ? `${C.paidOn} ${formatDateFr(new Date(m.paidAt))}${m.paidReference ? ` · ${C.reference} ${m.paidReference}` : ""}`
                          : C.statuses[m.status]}
                      </div>
                    </div>
                    <div className="font-mono text-[14px] font-bold whitespace-nowrap">
                      {formatSignedFC(m.totalFc)}
                    </div>
                    <Pill tone={tone[m.status]}>{C.statuses[m.status]}</Pill>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {period !== current ? (
            <Link
              href="/agent/commissions"
              className="mt-2 flex min-h-12 items-center justify-center rounded-lg border border-[#D5CFCF] px-3 text-[13.5px] font-semibold"
            >
              {C.backToCurrent}
            </Link>
          ) : null}
        </div>
      </div>
    </>
  );
}
