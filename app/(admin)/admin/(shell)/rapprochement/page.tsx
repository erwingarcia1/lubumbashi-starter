import { getDb } from "@/lib/db/client";
import { requireAdmin } from "@/lib/identity/session";
import { canReconcile } from "@/lib/identity/roles";
import { formatDateFr, formatDateTimeFr, formatFC } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { availableChannels } from "@/lib/payments/registry";
import { closeHistory } from "@/lib/reconciliation/actions";
import { reconciliationDay } from "@/lib/reconciliation/view";
import { businessDate, requestNow } from "@/lib/time";

import {
  closeDayAction,
  reconciliationExceptionAction,
  runReconciliationAction,
} from "../../_actions";
import { Banner } from "../../_components/banner";
import { PendingButton } from "../../_components/pending-button";
import { Pill } from "../../_components/pill";
import { ExceptionActions } from "./exception-actions";

const R = t.admin.reconciliation;

/** d-recon: one business day, per-provider status, the exceptions to clear, the daily close. */
export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; ok?: string; error?: string }>;
}) {
  const [{ day: rawDay, ok, error }, session] = await Promise.all([searchParams, requireAdmin()]);
  const today = businessDate(requestNow());
  const day = rawDay && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : today;
  const db = getDb();
  const channels = availableChannels();
  const [view, history] = await Promise.all([
    reconciliationDay(db, day, channels),
    closeHistory(db),
  ]);
  const canAct = canReconcile(session.role);
  const okMessage = ok === "run" ? R.runDone : ok ? R.done[ok as keyof typeof R.done] : undefined;
  const open = view.exceptions.filter((e) => e.status === "open");
  const resolved = view.exceptions.filter((e) => e.status === "resolved");
  const canClose =
    canAct &&
    !view.close &&
    open.length === 0 &&
    view.runs.every((r) => r.run?.status === "completed");
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">
          {R.title} · {formatDateFr(day)}
        </h2>
        <form method="get" className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <label htmlFor="day" className="text-[#5C5456]">
            {R.day}
          </label>
          <input
            id="day"
            name="day"
            type="date"
            defaultValue={day}
            max={today}
            className="h-11 min-w-0 rounded-md border border-[#D5CFCF] bg-white px-2 md:h-8"
          />
          <button
            type="submit"
            className="h-11 rounded-md border border-[#D5CFCF] bg-white px-3 md:h-8"
          >
            {t.common.search}
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-2 md:ml-auto">
          {view.runs.map(({ provider, run }) => (
            <Pill
              key={provider}
              tone={
                !run
                  ? "warn"
                  : run.status !== "completed"
                    ? "bad"
                    : run.exceptionCount > 0
                      ? "warn"
                      : "ok"
              }
            >
              {t.status.channel[provider]}{" "}
              {!run
                ? `· ${R.notRun}`
                : run.status !== "completed"
                  ? R.failed
                  : run.exceptionCount > 0
                    ? R.warn
                    : R.ok}
            </Pill>
          ))}
          {canAct ? (
            <form action={runReconciliationAction}>
              <input type="hidden" name="day" value={day} />
              <PendingButton
                label={R.run}
                pendingLabel={R.running}
                className="h-11 rounded-md bg-[#C1121F] px-3 text-[12.5px] font-semibold text-white disabled:opacity-60 md:h-8"
              />
            </form>
          ) : null}
        </div>
      </div>
      <Banner ok={okMessage} error={error} />
      {!canAct ? <p className="text-[12.5px] text-[#5C5456]">{R.readOnly}</p> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          [
            R.kpi.platform,
            String(view.totals.platformCount),
            formatFC(view.totals.platformTotalFc),
          ],
          [
            R.kpi.statement,
            String(view.totals.statementCount),
            formatFC(view.totals.statementTotalFc),
          ],
          [R.kpi.matched, String(view.totals.matchedCount), ""],
          [R.kpi.exceptions, String(open.length), open.length ? R.kpi.toHandle : ""],
        ].map(([label, value, sub]) => (
          <div
            key={label}
            className="min-w-0 rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3"
          >
            <div className="text-[11px] tracking-wider text-[#5C5456] uppercase">{label}</div>
            <div
              className={`font-mono text-[22px] font-bold ${label === R.kpi.exceptions && open.length ? "text-bad" : ""}`}
            >
              {value}
            </div>
            <div className="text-[12px] text-[#5C5456]">{sub}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#E3DEDE] bg-white">
        <table className="w-full min-w-[880px] text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] tracking-wider text-[#5C5456] uppercase">
              {[
                R.columns.type,
                R.columns.reference,
                R.columns.provider,
                R.columns.platform,
                R.columns.statement,
                R.columns.taxpayer,
                R.columns.action,
              ].map((h) => (
                <th key={h} className="border-b border-[#D5CFCF] px-2.5 py-2 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.exceptions.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2.5 py-3 text-[#5C5456]">
                  {R.noExceptions}
                </td>
              </tr>
            ) : null}
            {[...open, ...resolved].map((e) => (
              <tr
                key={e.id}
                className={`border-b border-[#EFEAEA] align-top ${e.status === "resolved" ? "opacity-60" : ""}`}
              >
                <td className="px-2.5 py-2">
                  <Pill
                    tone={
                      e.status === "resolved"
                        ? "ok"
                        : e.type === "missing_on_platform"
                          ? "warn"
                          : "bad"
                    }
                  >
                    {R.types[e.type]}
                  </Pill>
                </td>
                <td className="px-2.5 py-2 font-mono">
                  {e.platformReference ?? e.providerReference}
                  {e.platformReference && e.providerReference ? (
                    <div className="text-[11px] text-[#5C5456]">{e.providerReference}</div>
                  ) : null}
                </td>
                <td className="px-2.5 py-2">{t.status.channel[e.provider]}</td>
                <td className="px-2.5 py-2 text-right font-mono whitespace-nowrap">
                  {e.platformAmountFc === null ? t.common.none : formatFC(e.platformAmountFc)}
                </td>
                <td className="px-2.5 py-2 text-right font-mono whitespace-nowrap">
                  {e.statementAmountFc === null ? t.common.none : formatFC(e.statementAmountFc)}
                </td>
                <td className="px-2.5 py-2">
                  {e.taxpayerName ? (
                    <>
                      {e.taxpayerName}
                      <div className="font-mono text-[11px] text-[#5C5456]">{e.taxpayerNo}</div>
                    </>
                  ) : (
                    <>
                      {R.unknownPayer}
                      {e.payerPhone ? (
                        <div className="font-mono text-[11px] text-[#5C5456]">
                          {e.payerPhone.replace(/^(\+\d{5})\d+(\d{4})$/, "$1 ••• $2")}
                        </div>
                      ) : null}
                    </>
                  )}
                </td>
                <td className="px-2.5 py-2">
                  {e.status === "resolved" ? (
                    <span className="text-ok text-[12px]">
                      {R.resolved}
                      {e.resolvedAt ? ` · ${formatDateTimeFr(e.resolvedAt)}` : ""}
                      <div className="text-[11px] text-[#5C5456]">{e.resolution}</div>
                    </span>
                  ) : canAct ? (
                    <ExceptionActions
                      day={day}
                      exception={{
                        id: e.id,
                        type: e.type,
                        provider: e.provider,
                        paymentStatus: e.paymentStatus,
                      }}
                      action={reconciliationExceptionAction}
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3">
          <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">{R.close}</p>
          {view.close ? (
            <p className="text-ok mt-2 text-[13px] font-semibold">
              {R.closed} · {formatDateTimeFr(view.close.closedAt)} · {view.close.transactionCount}{" "}
              {R.transactions} · {formatFC(view.close.totalFc)}
            </p>
          ) : canClose ? (
            <form action={closeDayAction} className="mt-2 flex flex-col gap-2">
              <input type="hidden" name="day" value={day} />
              <label className="text-[12.5px] text-[#5C5456]" htmlFor="closeNote">
                {R.closeNote}
              </label>
              <input
                id="closeNote"
                name="note"
                className="h-11 rounded-md border border-[#D5CFCF] px-2 text-[13px] md:h-9"
              />
              <PendingButton
                label={R.close}
                pendingLabel={R.closing}
                className="h-11 rounded-md bg-[#1E7F4F] px-3 text-[13px] font-semibold text-white disabled:opacity-60 md:h-10"
              />
            </form>
          ) : (
            <p className="mt-2 text-[12.5px] text-[#5C5456]">
              {open.length > 0
                ? t.admin.errors.open_exceptions
                : view.runs.some((r) => r.run?.status !== "completed")
                  ? t.admin.errors.missing_statement
                  : R.readOnly}
            </p>
          )}
        </div>
        <div className="min-w-0 rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3 text-[12.5px]">
          <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
            {R.history}
          </p>
          {history.length === 0 ? <p className="mt-2 text-[#5C5456]">{R.noHistory}</p> : null}
          {history.map((h) => (
            <div
              key={h.businessDate}
              className="border-b border-[#EFEAEA] py-1.5 break-words last:border-0"
            >
              <b>{formatDateFr(h.businessDate)}</b> · {formatDateTimeFr(h.closedAt).slice(6)} ·{" "}
              {h.resolved > 0 ? R.closedWith.replace("{n}", String(h.resolved)) : R.closedWithout} ·{" "}
              {h.transactionCount} {R.transactions} · {formatFC(h.totalFc)}
              {h.closedBy ? ` · ${h.closedBy}` : ""}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
