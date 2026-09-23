import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getTaxpayerDetail } from "@/lib/admin/taxpayers";
import { getDb } from "@/lib/db/client";
import { canEditTaxpayer, canIssueInvoice } from "@/lib/identity/roles";
import { requireAdmin } from "@/lib/identity/session";
import { formatDateFr, formatDateTimeFr, formatFC, formatMonthFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { businessDate } from "@/lib/time";

import { changeCategoryAction, reversePaymentAction, updateContactAction } from "../../../_actions";
import { Banner } from "../../../_components/banner";
import { Pill, type PillTone } from "../../../_components/pill";

const pillTone = { paid: "ok", due: "warn", late: "bad" } as const;

function obligationPill(
  o: { status: string; dueDate: string; paidFc: number; amountFc: number; penaltyFc: number },
  today: string,
): { tone: PillTone; label: string } {
  if (o.status === "paid") return { tone: "ok", label: t.status.obligation.paid };
  if (o.status === "waived") return { tone: "n", label: t.status.obligation.waived };
  if (o.status === "cancelled") return { tone: "n", label: t.status.obligation.cancelled };
  if (o.dueDate < today)
    return {
      tone: "bad",
      label: `${t.status.obligation.late} ${Math.round((Date.parse(today) - Date.parse(o.dueDate)) / 86_400_000)} ${t.admin.taxes.days}`,
    };
  if (o.status === "partially_paid")
    return { tone: "warn", label: t.status.obligation.partially_paid };
  return { tone: "warn", label: t.status.obligation.due };
}

export default async function TaxpayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ taxpayerNo: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const [{ taxpayerNo }, { ok, error }, session] = await Promise.all([
    params,
    searchParams,
    requireAdmin(),
  ]);
  const d = await getTaxpayerDetail(getDb(), taxpayerNo);
  if (!d) notFound();
  const today = businessDate(new Date());
  const D = t.admin.taxpayers.detail;
  const editable = canEditTaxpayer(session.role);
  const canIssue = canIssueInvoice(session.role);
  const canReverse = session.role === "finances" || session.role === "administrateur";
  const okMessage =
    ok === "reversed"
      ? D.reverseDone
      : ok === "contact"
        ? D.contactSaved
        : ok === "category"
          ? D.categorySaved
          : undefined;
  const firstEntity = d.entities[0];
  const lateSince = d.obligations
    .filter((o) => o.dueDate < today && (o.status === "due" || o.status === "partially_paid"))
    .map((o) => o.dueDate)
    .sort()[0];

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/contribuables"
          className="inline-flex min-h-11 items-center text-[12.5px] text-[#C1121F] underline md:min-h-0"
        >
          ← {t.common.back}
        </Link>
        <h2 className="min-w-0 text-lg font-bold break-words">{d.taxpayer.fullName}</h2>
        <Pill tone={pillTone[d.balance.pill]}>{t.status.pill[d.balance.pill]}</Pill>
      </div>
      <Banner ok={okMessage} error={error} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="rounded-lg border border-[#E3DEDE] bg-white p-3.5">
            <div className="grid gap-x-4 text-[13.5px] md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {[
                [
                  D.id,
                  <span key="id" className="font-mono">
                    {d.taxpayer.taxpayerNo}
                  </span>,
                ],
                [
                  D.phone,
                  <span key="ph" className="font-mono">
                    {d.taxpayer.phone}
                  </span>,
                ],
                [D.address, `${d.taxpayer.address}${d.quartier ? `, ${d.quartier}` : ""}`],
                [
                  D.gps,
                  <span key="gps" className="font-mono">
                    {firstEntity
                      ? `${firstEntity.entity.location.y.toFixed(4)}, ${firstEntity.entity.location.x.toFixed(4)}`
                      : t.common.none}
                  </span>,
                ],
                [D.registered, formatDateFr(d.taxpayer.registeredAt)],
                [D.category, firstEntity?.categoryLabel ?? t.common.none],
              ].map(([k, v], i) => (
                <div
                  key={i}
                  className="flex justify-between gap-2 border-b border-[#EFEAEA] py-1.5"
                >
                  <span className="shrink-0 text-[#5C5456]">{k}</span>
                  <b className="min-w-0 text-right font-semibold break-words">{v}</b>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border-l-4 border-[#C1121F] bg-white p-3.5 shadow-sm">
            <div className="text-[12.5px] text-[#5C5456]">{D.balance}</div>
            <div
              className={`font-mono text-2xl font-bold ${d.balance.outstandingFc > 0 ? "text-[#C1121F]" : "text-ok"}`}
            >
              {formatFC(d.balance.outstandingFc)}
            </div>
            {d.balance.lateFc > 0 && lateSince ? (
              <div className="text-[12.5px] text-[#5C5456]">
                {formatFC(d.balance.lateFc)} {D.lateSince} {formatDateFr(lateSince)}
              </div>
            ) : null}
          </div>
          <div className="rounded-lg border border-[#E3DEDE] bg-white p-3.5">
            <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
              {D.entities}
            </p>
            {d.entities.map((e) => (
              <div
                key={e.entity.id}
                className="border-b border-[#EFEAEA] py-1.5 text-[13px] last:border-0"
              >
                <b>{e.entity.name}</b>
                <div className="text-[12.5px] text-[#5C5456]">{e.categoryLabel}</div>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border border-[#E3DEDE] bg-white p-3.5">
            <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
              {D.obligations}
            </p>
            <table className="mt-1.5 w-full text-[12.5px] whitespace-nowrap md:whitespace-normal">
              <thead>
                <tr className="text-left text-[10.5px] tracking-wider text-[#5C5456] uppercase">
                  <th className="border-b border-[#D5CFCF] px-2 py-1.5">{D.columns.tax}</th>
                  <th className="border-b border-[#D5CFCF] px-2 py-1.5">{D.columns.period}</th>
                  <th className="border-b border-[#D5CFCF] px-2 py-1.5 text-right">
                    {D.columns.amount}
                  </th>
                  <th className="border-b border-[#D5CFCF] px-2 py-1.5 text-right">
                    {D.columns.penalty}
                  </th>
                  <th className="border-b border-[#D5CFCF] px-2 py-1.5">{D.columns.due}</th>
                  <th className="border-b border-[#D5CFCF] px-2 py-1.5">{D.columns.status}</th>
                  <th className="border-b border-[#D5CFCF] px-2 py-1.5">{D.columns.invoice}</th>
                </tr>
              </thead>
              <tbody>
                {d.obligations.map((o) => {
                  const p = obligationPill(o, today);
                  return (
                    <tr key={o.id} className="border-b border-[#EFEAEA]">
                      <td className="px-2 py-1.5">{o.ruleLabel}</td>
                      <td className="px-2 py-1.5">
                        {formatMonthFr(o.periodStart)}
                        {o.periodEnd.slice(0, 7) !== o.periodStart.slice(0, 7)
                          ? ` → ${formatMonthFr(o.periodEnd)}`
                          : ""}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">{formatFC(o.amountFc)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {o.penaltyFc ? formatFC(o.penaltyFc) : t.common.none}
                      </td>
                      <td className="px-2 py-1.5 font-mono">{formatDateFr(o.dueDate)}</td>
                      <td className="px-2 py-1.5">
                        <Pill tone={p.tone}>{p.label}</Pill>
                      </td>
                      <td className="px-2 py-1.5">
                        {canIssue &&
                        o.invoiceNo &&
                        (o.status === "due" || o.status === "partially_paid") ? (
                          <a
                            href={`/api/v1/admin/invoices/${o.invoiceNo}/pdf`}
                            target="_blank"
                            rel="noopener"
                            className="inline-flex min-h-11 items-center text-[#C1121F] underline md:min-h-0"
                          >
                            {t.admin.invoices.link}
                          </a>
                        ) : o.invoiceIssuedAt ? null : (
                          t.common.none
                        )}
                        {o.invoiceIssuedAt ? (
                          <div className="text-[11.5px] text-[#5C5456]">
                            {t.admin.invoices.issuedOn} {formatDateFr(o.invoiceIssuedAt)}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded-lg border border-[#E3DEDE] bg-white p-3.5">
            <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
              {D.payments}
            </p>
            <table className="mt-1.5 w-full text-[12.5px] whitespace-nowrap md:whitespace-normal">
              <thead>
                <tr className="text-left text-[10.5px] tracking-wider text-[#5C5456] uppercase">
                  <th className="border-b border-[#D5CFCF] px-2 py-1.5">{D.columns.date}</th>
                  <th className="border-b border-[#D5CFCF] px-2 py-1.5">{D.columns.receipt}</th>
                  <th className="border-b border-[#D5CFCF] px-2 py-1.5">{D.columns.channel}</th>
                  <th className="border-b border-[#D5CFCF] px-2 py-1.5">{D.columns.providerRef}</th>
                  <th className="border-b border-[#D5CFCF] px-2 py-1.5 text-right">
                    {D.columns.amount}
                  </th>
                  <th className="border-b border-[#D5CFCF] px-2 py-1.5">{D.columns.status}</th>
                </tr>
              </thead>
              <tbody>
                {d.payments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-2 text-[#5C5456]">
                      {D.noPayments}
                    </td>
                  </tr>
                ) : null}
                {d.payments.map(({ p, providerReference, receiptNo }) => (
                  <tr key={p.id} className="border-b border-[#EFEAEA]">
                    <td className="px-2 py-1.5 font-mono">{formatDateTimeFr(p.createdAt)}</td>
                    <td className="px-2 py-1.5 font-mono">{receiptNo ?? t.common.none}</td>
                    <td className="px-2 py-1.5">
                      {t.status.channel[p.channel]} · {t.status.origin[p.origin]}
                    </td>
                    <td className="px-2 py-1.5 font-mono">{providerReference ?? t.common.none}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{formatFC(p.amountFc)}</td>
                    <td className="px-2 py-1.5">
                      <Pill
                        tone={
                          p.status === "confirmed" ? "ok" : p.status === "failed" ? "bad" : "warn"
                        }
                      >
                        {t.status.payment[p.status]}
                      </Pill>
                      {canReverse && p.status === "confirmed" ? (
                        <form
                          action={reversePaymentAction}
                          className="mt-1 flex flex-wrap items-center gap-1"
                        >
                          <input type="hidden" name="taxpayerNo" value={d.taxpayer.taxpayerNo} />
                          <input type="hidden" name="reference" value={p.reference} />
                          <input
                            name="reason"
                            required
                            minLength={5}
                            placeholder={D.reverseReason}
                            aria-label={`${D.reverseReason} ${p.reference}`}
                            className="h-11 w-36 rounded-md border border-[#D5CFCF] px-1.5 text-[11.5px] md:h-7"
                          />
                          <button
                            type="submit"
                            className="text-bad h-11 shrink-0 rounded-md border border-[#D5CFCF] bg-white px-2 text-[11px] font-semibold whitespace-nowrap md:h-7"
                          >
                            {D.reverse}
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid h-44 place-items-center rounded-lg border border-[#D9E2DB] bg-[#E8EFE9] text-[12.5px] text-[#4E5E52]">
            {D.mapSoon}
          </div>
          {editable ? (
            <details className="rounded-lg border border-[#E3DEDE] bg-white p-3.5">
              <summary className="-m-3.5 cursor-pointer p-3.5 text-[13px] font-bold tracking-wide text-[#5C5456] uppercase md:m-0 md:p-0">
                {D.editContact}
              </summary>
              <form action={updateContactAction} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="taxpayerNo" value={d.taxpayer.taxpayerNo} />
                <Label htmlFor="phone">{D.phone}</Label>
                <Input
                  id="phone"
                  name="phone"
                  defaultValue={d.taxpayer.phone}
                  pattern="^\+[1-9][0-9]{6,14}$"
                  required
                  className="h-11 font-mono md:h-8"
                />
                <Label htmlFor="address">{D.address}</Label>
                <Input
                  id="address"
                  name="address"
                  defaultValue={d.taxpayer.address}
                  required
                  className="h-11 md:h-8"
                />
                <Button type="submit" size="sm" className="h-11 self-start md:h-7">
                  {t.common.save}
                </Button>
              </form>
            </details>
          ) : null}
          {editable && firstEntity ? (
            <details className="rounded-lg border border-[#E3DEDE] bg-white p-3.5">
              <summary className="-m-3.5 cursor-pointer p-3.5 text-[13px] font-bold tracking-wide text-[#5C5456] uppercase md:m-0 md:p-0">
                {D.changeCategory}
              </summary>
              <form action={changeCategoryAction} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="taxpayerNo" value={d.taxpayer.taxpayerNo} />
                <input type="hidden" name="entityId" value={firstEntity.entity.id} />
                <Label htmlFor="categoryCode">{D.newCategory}</Label>
                <select
                  id="categoryCode"
                  name="categoryCode"
                  defaultValue={firstEntity.categoryCode}
                  className="h-11 rounded-md border border-[#D5CFCF] bg-white px-2 text-[13px] md:h-9"
                >
                  {d.categories.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.labelFr}
                    </option>
                  ))}
                </select>
                <Label htmlFor="reason">{D.reason}</Label>
                <Textarea id="reason" name="reason" rows={2} minLength={5} required />
                <Button type="submit" size="sm" className="h-11 self-start md:h-7">
                  {t.common.save}
                </Button>
              </form>
            </details>
          ) : null}
          <div className="rounded-lg border border-[#E3DEDE] bg-white p-3.5">
            <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
              {D.journal}
            </p>
            <div className="mt-1.5 flex flex-col">
              {d.journal.length === 0 ? (
                <p className="text-[12.5px] text-[#5C5456]">{D.noJournal}</p>
              ) : null}
              {d.journal.map((e) => (
                <div
                  key={e.id}
                  className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 border-b border-[#EFEAEA] py-1.5 text-[12.5px] break-words last:border-0"
                >
                  <span className="font-mono text-[11.5px] text-[#5C5456]">
                    {formatDateTimeFr(e.createdAt)}
                  </span>
                  <span>
                    {e.action} · {e.actorLabel ?? e.actorType}
                    {e.reason ? <span className="text-[#5C5456]"> · {e.reason}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
