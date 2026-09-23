import { formatRateBp, formatSignedFC } from "@/lib/commissions/format";
import { isPeriod, periodOf } from "@/lib/commissions/period";
import { listRules } from "@/lib/commissions/rules";
import { listStatements } from "@/lib/commissions/statements";
import { getDb } from "@/lib/db/client";
import { admins, taxRules } from "@/lib/db/schema";
import { canEditCommissionRules, canManageCommissions } from "@/lib/identity/roles";
import { requireAdmin } from "@/lib/identity/session";
import { formatDateFr, formatFC, formatMonthFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { businessDate, requestNow } from "@/lib/time";

import { Banner } from "../../_components/banner";
import { PendingButton } from "../../_components/pending-button";
import { Pill } from "../../_components/pill";
import { approveAction, createRuleAction, markPaidAction, recomputeAction } from "./actions";

const C = t.admin.commissions;
const tone = { draft: "n", approved: "warn", paid: "ok" } as const;
const fieldCls =
  "h-11 w-full min-w-0 rounded-md border border-[#D5CFCF] bg-white px-2 text-base text-[#1B1B1F] md:h-8 md:w-auto md:text-[12.5px]";
const th = "border-b border-[#D5CFCF] px-2.5 py-2 font-semibold whitespace-nowrap";
const td = "px-2.5 py-2";

/** Commissions des agents (D36): one month, one row per agent, approve → pay; the scale below. */
export default async function CommissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string; ok?: string; error?: string }>;
}) {
  const [{ mois, ok, error }, session] = await Promise.all([searchParams, requireAdmin()]);
  const now = requestNow();
  const current = periodOf(now);
  const period = isPeriod(mois) ? mois : current;
  const db = getDb();
  const [rows, rules, people, taxes] = await Promise.all([
    listStatements(db, period, now),
    listRules(db),
    db.select({ id: admins.id, fullName: admins.fullName }).from(admins),
    db.select({ id: taxRules.id, labelFr: taxRules.labelFr }).from(taxRules),
  ]);
  const canAct = canManageCommissions(session.role);
  const canEditRules = canEditCommissionRules(session.role);
  const today = businessDate(now);
  const nameOf = (id: string | null) =>
    id ? (people.find((p) => p.id === id)?.fullName ?? id) : t.common.none;
  const taxOf = (id: string | null) =>
    id ? (taxes.find((x) => x.id === id)?.labelFr ?? id) : C.rules.allTaxes;
  const okMessage =
    ok === "recomputed"
      ? C.recomputed
      : ok === "approved"
        ? C.approved
        : ok === "paid"
          ? C.paid
          : ok === "rule"
            ? C.rules.created
            : undefined;
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const nextMonth = (() => {
    const [y, m] = today.split("-").map(Number) as [number, number, number];
    return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  })();

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">
          {C.title} · {formatMonthFr(`${period}-01`)}
        </h2>
        <form method="get" className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <label htmlFor="mois" className="text-[#5C5456]">
            {C.month}
          </label>
          <input
            id="mois"
            name="mois"
            type="month"
            defaultValue={period}
            max={current}
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
          <a
            href={`/api/v1/admin/reports/commissions?format=xlsx&month=${period}`}
            className="inline-flex h-11 items-center rounded-md border border-[#D5CFCF] bg-white px-3 text-[12.5px] font-semibold md:h-8"
          >
            {C.export}
          </a>
          {canAct ? (
            <form action={recomputeAction}>
              <input type="hidden" name="period" value={period} />
              <PendingButton
                label={C.recompute}
                pendingLabel={C.recomputing}
                className="h-11 rounded-md bg-[#C1121F] px-3 text-[12.5px] font-semibold text-white disabled:opacity-60 md:h-8"
              />
            </form>
          ) : null}
        </div>
      </div>
      <Banner ok={okMessage} error={error} />
      {!canAct ? <p className="text-[12.5px] text-[#5C5456]">{C.readOnly}</p> : null}
      {canAct && period === current ? (
        <div className="border-warn bg-warn-soft rounded border-l-4 px-3 py-2 text-[12.5px]">
          {C.currentMonthWarning}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-[#E3DEDE] bg-white">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] tracking-wider text-[#5C5456] uppercase">
              <th className={th}>{C.columns.agent}</th>
              {[
                C.columns.collections,
                C.columns.collected,
                C.columns.commission,
                C.columns.registrations,
                C.columns.bonus,
                C.columns.total,
              ].map((h) => (
                <th key={h} className={`${th} text-right`}>
                  {h}
                </th>
              ))}
              <th className={th}>{C.columns.status}</th>
              {canAct ? <th className={th}>{C.columns.actions}</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className={`${td} text-[#5C5456]`} colSpan={canAct ? 9 : 8}>
                  {C.noAgents}
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.agentId} className="border-b border-[#EFEAEA] align-top">
                <td className={td}>
                  <span className="font-mono">{r.matricule}</span>
                  <br />
                  {r.fullName}
                </td>
                <td className={`${td} text-right font-mono`}>{r.collectionsCount}</td>
                <td className={`${td} text-right font-mono`}>{formatFC(r.collectedFc)}</td>
                <td className={`${td} text-right font-mono`}>
                  {formatSignedFC(r.collectionCommissionFc)}
                </td>
                <td className={`${td} text-right font-mono`}>{r.registrationsCount}</td>
                <td className={`${td} text-right font-mono`}>
                  {formatFC(r.registrationCommissionFc)}
                </td>
                <td className={`${td} text-right font-mono font-bold`}>
                  {formatSignedFC(r.totalFc)}
                </td>
                <td className={td}>
                  <Pill tone={tone[r.status]}>{C.statuses[r.status]}</Pill>
                  <div className="mt-1 text-[11px] text-[#5C5456]">
                    {r.status === "paid" && r.paidAt
                      ? `${C.paidOn} ${formatDateFr(r.paidAt)}${r.paidReference ? ` · ${r.paidReference}` : ""}`
                      : r.status === "approved" && r.approvedAt
                        ? `${C.approvedOn} ${formatDateFr(r.approvedAt)}`
                        : r.stored
                          ? formatDateFr(r.computedAt)
                          : C.computed}
                  </div>
                </td>
                {canAct ? (
                  <td className={td}>
                    {r.status === "draft" ? (
                      <form action={approveAction}>
                        <input type="hidden" name="period" value={period} />
                        <input type="hidden" name="agentId" value={r.agentId} />
                        <PendingButton
                          label={C.approve}
                          pendingLabel={C.approving}
                          className="h-11 rounded-md bg-[#C1121F] px-3 text-[12px] font-semibold text-white disabled:opacity-60 md:h-7"
                        />
                      </form>
                    ) : null}
                    {r.status === "approved" && r.statementId ? (
                      <form action={markPaidAction} className="flex items-center gap-1">
                        <input type="hidden" name="period" value={period} />
                        <input type="hidden" name="statementId" value={r.statementId} />
                        <input
                          name="reference"
                          required
                          minLength={3}
                          maxLength={80}
                          placeholder={C.paidReference}
                          aria-label={`${C.paidReference} ${r.matricule}`}
                          className="h-11 w-36 rounded-md border border-[#D5CFCF] px-1.5 font-mono text-base md:h-7 md:w-32 md:text-[11.5px]"
                        />
                        <PendingButton
                          label={C.markPaid}
                          pendingLabel={C.marking}
                          className="h-11 rounded-md border border-[#D5CFCF] bg-white px-2 text-[11px] font-semibold whitespace-nowrap disabled:opacity-60 md:h-7"
                        />
                      </form>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          {rows.length ? (
            <tfoot>
              <tr className="font-bold">
                <td className={td}>{C.totalRow}</td>
                <td className={`${td} text-right font-mono`}>{sum("collectionsCount")}</td>
                <td className={`${td} text-right font-mono`}>{formatFC(sum("collectedFc"))}</td>
                <td className={`${td} text-right font-mono`}>
                  {formatSignedFC(sum("collectionCommissionFc"))}
                </td>
                <td className={`${td} text-right font-mono`}>{sum("registrationsCount")}</td>
                <td className={`${td} text-right font-mono`}>
                  {formatFC(sum("registrationCommissionFc"))}
                </td>
                <td className={`${td} text-right font-mono`}>{formatSignedFC(sum("totalFc"))}</td>
                <td className={td} colSpan={canAct ? 2 : 1} />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <p className="text-[12px] text-[#5C5456]">{C.note}</p>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="overflow-x-auto rounded-lg border border-[#E3DEDE] bg-white">
          <p className="px-3.5 pt-3 text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
            {C.rules.title}
          </p>
          <table className="mt-2 w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] tracking-wider text-[#5C5456] uppercase">
                {[
                  C.rules.columns.rule,
                  C.rules.columns.basis,
                  C.rules.columns.value,
                  C.rules.columns.from,
                  C.rules.columns.to,
                  C.rules.columns.createdBy,
                ].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const inForce =
                  r.effectiveFrom <= today && (r.effectiveTo === null || r.effectiveTo > today);
                const upcoming = r.effectiveFrom > today;
                return (
                  <tr key={r.id} className="border-b border-[#EFEAEA]">
                    <td className={td}>
                      {r.labelFr}
                      <br />
                      <span className="text-[11px] text-[#5C5456]">{taxOf(r.taxRuleId)}</span>
                    </td>
                    <td className={td}>{C.rules.basis[r.basis]}</td>
                    <td className={`${td} font-mono whitespace-nowrap`}>
                      {r.basis === "collection_percent"
                        ? formatRateBp(r.rateBp)
                        : `${formatFC(r.amountFc)} ${C.rules.perRegistration}`}
                    </td>
                    <td className={`${td} font-mono whitespace-nowrap`}>
                      {formatDateFr(r.effectiveFrom)}{" "}
                      {inForce ? (
                        <Pill tone="ok">{t.status.version.approved}</Pill>
                      ) : upcoming ? (
                        <Pill tone="warn">{t.status.version.upcoming}</Pill>
                      ) : (
                        <Pill tone="n">{t.status.version.superseded}</Pill>
                      )}
                    </td>
                    <td className={`${td} font-mono whitespace-nowrap`}>
                      {r.effectiveTo ? formatDateFr(r.effectiveTo) : t.common.none}
                    </td>
                    <td className={td}>{nameOf(r.createdByAdminId)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="rounded-lg border border-[#E3DEDE] bg-white p-3.5">
          <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
            {C.rules.newVersion}
          </p>
          <p className="mt-1 text-[12px] text-[#5C5456]">{C.rules.hint}</p>
          {canEditRules ? (
            <form action={createRuleAction} className="mt-2 flex flex-col gap-2.5 text-[12.5px]">
              <input type="hidden" name="period" value={period} />
              <label className="flex flex-col gap-0.5 text-[#5C5456]">
                {C.rules.columns.basis}
                <select name="basis" required className={`${fieldCls} md:w-full`}>
                  <option value="collection_percent">{C.rules.basis.collection_percent}</option>
                  <option value="registration_fixed">{C.rules.basis.registration_fixed}</option>
                </select>
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-0.5 text-[#5C5456]">
                  {C.rules.rate}
                  <input
                    name="ratePct"
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    inputMode="decimal"
                    className={`${fieldCls} font-mono md:w-full`}
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-[#5C5456]">
                  {C.rules.amount}
                  <input
                    name="amountFc"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    className={`${fieldCls} font-mono md:w-full`}
                  />
                </label>
              </div>
              <label className="flex flex-col gap-0.5 text-[#5C5456]">
                {C.rules.effectiveFrom}
                <input
                  name="effectiveFrom"
                  type="date"
                  required
                  defaultValue={nextMonth}
                  min={today}
                  className={`${fieldCls} md:w-full`}
                />
              </label>
              <button
                type="submit"
                className="h-11 rounded-md bg-[#C1121F] px-3 text-[12.5px] font-semibold text-white md:h-8 md:self-start"
              >
                {C.rules.submit}
              </button>
            </form>
          ) : (
            <p className="mt-2 text-[12.5px] text-[#5C5456]">{C.rules.adminOnly}</p>
          )}
        </div>
      </div>
    </>
  );
}
