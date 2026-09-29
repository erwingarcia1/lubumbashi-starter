import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getTaxpayerDetail, listTaxpayers } from "@/lib/admin/taxpayers";
import { getDb } from "@/lib/db/client";
import { canIssueInvoice } from "@/lib/identity/roles";
import { requireAdmin } from "@/lib/identity/session";
import { formatDateFr, formatFC, formatMonthFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { registrationMonthOf } from "@/lib/invoices/bareme";
import { applicableRuleCodes, loadCreateOptions } from "@/lib/invoices/create";
import { businessDate, requestNow } from "@/lib/time";

import { Pill } from "../../_components/pill";
import { createNoteAction } from "./actions";
import { InvoiceSelectionForm } from "./invoice-selection-form";
import { NewNoteForm } from "./new-note-form";

const S = t.admin.invoices.screen;
const C = t.admin.taxpayers.detail.columns;
const tone = { paid: "ok", due: "warn", late: "bad" } as const;
const th = "border-b border-[#D5CFCF] px-2.5 py-2 text-left font-semibold whitespace-nowrap";
const td = "px-2.5 py-2";

/** Route of the combined PDF (one page per note); the first print issues the unissued notes. */
const INVOICES_PDF_ROUTE = "/api/v1/admin/invoices/pdf";
/** A note number as `?note=` may carry it after a creation; anything else is ignored. */
const INVOICE_NO = /^AV-\d{4}-\d{6}$/;
/** « Note {no} créée et émise. » with the number set in bold: the text around the placeholder. */
const [createdBefore = "", createdAfter = ""] = S.create.created.split("{no}");

/**
 * /admin/notes-de-perception: the Mairie user (Finances, Administrateur, Superviseur, Maire)
 * searches a taxpayer, chooses it, creates a new note with the details of her choice (card
 * « Nouvelle note de perception », issued at once) or prints the notes of its open obligations,
 * without going through the taxpayer record. The Auditeur is sent to « Accès refusé ».
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; contribuable?: string; note?: string }>;
}) {
  const [sp, session] = await Promise.all([searchParams, requireAdmin()]);
  if (!canIssueInvoice(session.role)) redirect("/admin/interdit");
  const db = getDb();
  const now = requestNow();
  const q = sp.q?.trim() ?? "";
  const chosenNo = sp.contribuable?.trim() ?? "";
  const createdNo = INVOICE_NO.test(sp.note?.trim() ?? "") ? sp.note!.trim() : null;
  const chosen = chosenNo ? await getTaxpayerDetail(db, chosenNo, now) : null;
  const results = !chosen && q ? await listTaxpayers(db, { q, pageSize: 25 }, now) : null;
  const open = chosen
    ? chosen.obligations.filter((o) => o.status === "due" || o.status === "partially_paid")
    : [];
  const openIds = open.map((o) => o.id);
  const activeEntities = chosen
    ? chosen.entities.filter((e) => e.entity.active && e.entity.status === "active")
    : [];
  const options = chosen ? await loadCreateOptions(db, now) : null;
  // The rules each entity may be billed for (category ± overrides): the tax select offers no other.
  const ruleCodes = options
    ? await applicableRuleCodes(
        db,
        activeEntities.map((e) => e.entity),
        options.rules,
      )
    : {};
  const searchHref = q
    ? `/admin/notes-de-perception?q=${encodeURIComponent(q)}`
    : "/admin/notes-de-perception";

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">{S.title}</h2>
        <Link
          href="/admin/rapports"
          className="ml-auto inline-flex min-h-11 items-center text-[12.5px] text-[#C1121F] underline md:min-h-0"
        >
          {S.printRun} →
        </Link>
      </div>
      <p className="text-[12.5px] text-[#5C5456]">{S.intro}</p>

      <form
        method="get"
        className="grid grid-cols-1 gap-2 rounded-lg border border-[#E3DEDE] bg-white p-3.5 text-[12.5px] md:flex md:flex-wrap md:items-end"
      >
        <label className="flex min-w-0 flex-col gap-1 text-[#5C5456] md:flex-1 lg:max-w-md">
          {S.search}
          <Input
            name="q"
            defaultValue={q}
            placeholder={S.searchPlaceholder}
            autoComplete="off"
            className="h-11 md:h-9"
          />
        </label>
        <Button type="submit" size="sm" variant="outline" className="h-11 md:h-9">
          {t.common.search}
        </Button>
      </form>

      {chosenNo && !chosen ? (
        <div className="border-bad bg-bad-soft rounded border-l-4 px-3 py-2 text-[12.5px]">
          {S.noTaxpayer} : <span className="font-mono">{chosenNo}</span>
        </div>
      ) : null}

      {results ? (
        <div className="overflow-x-auto rounded-lg border border-[#E3DEDE] bg-white">
          <table className="w-full text-[12.5px]">
            <caption className="px-2.5 py-2 text-left text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
              {S.results} · {results.total}
              {results.total > results.items.length ? (
                <span className="ml-2 font-normal normal-case">
                  {S.truncated.replace("{n}", String(results.items.length))}{" "}
                  <a
                    href={`/admin/contribuables?q=${encodeURIComponent(q ?? "")}`}
                    className="text-[#C1121F] underline"
                  >
                    {S.fullList}
                  </a>
                </span>
              ) : null}
            </caption>
            <thead>
              <tr className="text-[10.5px] tracking-wider text-[#5C5456] uppercase">
                <th className={th}>{t.admin.taxpayers.columns.id}</th>
                <th className={th}>{t.admin.taxpayers.columns.name}</th>
                <th className={th}>
                  {t.admin.taxpayers.commune} / {t.admin.taxpayers.columns.quartier}
                </th>
                <th className={`${th} text-right`}>{S.outstanding}</th>
                <th className={th}>{t.admin.taxpayers.columns.status}</th>
                <th className={th}>
                  <span className="sr-only">{S.choose}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {results.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2.5 py-4 text-center text-[#5C5456]">
                    {S.noTaxpayer}
                  </td>
                </tr>
              ) : null}
              {results.items.map((r) => (
                <tr key={r.taxpayerNo} className="border-t border-[#EFEAEA] hover:bg-[#FFF6F6]">
                  <td className={`${td} font-mono whitespace-nowrap`}>{r.taxpayerNo}</td>
                  <td className={`${td} min-w-32`}>{r.fullName}</td>
                  <td className={td}>
                    {r.commune}
                    {r.quartier ? ` / ${r.quartier}` : ""}
                  </td>
                  <td className={`${td} text-right font-mono whitespace-nowrap`}>
                    {formatFC(r.balance.outstandingFc)}
                  </td>
                  <td className={td}>
                    <Pill tone={tone[r.balance.pill]}>{t.status.pill[r.balance.pill]}</Pill>
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    <Link
                      href={
                        `/admin/notes-de-perception?contribuable=${r.taxpayerNo}${q ? `&q=${encodeURIComponent(q)}` : ""}` as never
                      }
                      className="inline-flex h-11 items-center rounded-md border border-[#D5CFCF] bg-white px-3 font-semibold text-[#C1121F] md:h-8"
                      aria-label={`${S.choose} ${r.taxpayerNo}`}
                    >
                      {S.choose}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!results && !chosen ? <p className="text-[12.5px] text-[#5C5456]">{S.chooseHint}</p> : null}

      {chosen ? (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border-l-4 border-[#C1121F] bg-white p-3.5 shadow-sm">
            <div className="min-w-0">
              <div className="text-[12.5px] text-[#5C5456]">{S.chosen}</div>
              <b className="block text-[15px] break-words">{chosen.taxpayer.fullName}</b>
              <div className="font-mono text-[12.5px]">
                {chosen.taxpayer.taxpayerNo} · {chosen.taxpayer.phone}
              </div>
              <div className="text-[12.5px] text-[#5C5456]">
                {chosen.commune?.name ?? t.common.none}
                {chosen.quartier ? ` / ${chosen.quartier}` : ""} · {chosen.taxpayer.address}
              </div>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-3 text-[12.5px]">
              <Pill tone={tone[chosen.balance.pill]}>{t.status.pill[chosen.balance.pill]}</Pill>
              <Link
                href={`/admin/contribuables/${chosen.taxpayer.taxpayerNo}` as never}
                className="inline-flex min-h-11 items-center text-[#C1121F] underline md:min-h-0"
              >
                {S.openRecord}
              </Link>
              <Link
                href={searchHref as never}
                className="inline-flex min-h-11 items-center text-[#C1121F] underline md:min-h-0"
              >
                {S.change}
              </Link>
            </div>
          </div>

          {createdNo ? (
            <div className="border-ok bg-ok-soft flex flex-wrap items-center gap-x-3 gap-y-1 rounded border-l-4 px-3 py-2 text-[12.5px]">
              <span>
                {createdBefore}
                <b className="font-mono">{createdNo}</b>
                {createdAfter}
              </span>
              <a
                href={`/api/v1/admin/invoices/${createdNo}/pdf`}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-11 items-center font-semibold text-[#C1121F] underline md:min-h-0"
              >
                {S.create.open} →
              </a>
            </div>
          ) : null}

          <div
            id="nouvelle"
            className="scroll-mt-4 rounded-lg border border-[#E3DEDE] bg-white p-3.5"
          >
            <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
              {S.create.title}
            </p>
            <p className="mt-1 text-[12.5px] text-[#5C5456]">{S.create.hint}</p>
            {activeEntities.length === 0 || !options ? (
              <p className="mt-2 text-[12.5px]">
                <b>{S.create.noEntity}</b>
              </p>
            ) : (
              <NewNoteForm
                action={createNoteAction}
                taxpayerNo={chosen.taxpayer.taxpayerNo}
                q={q}
                entities={activeEntities.map((e) => ({
                  id: e.entity.id,
                  name: e.entity.name,
                  categoryId: e.entity.categoryId,
                  categoryLabel: e.categoryLabel,
                  taxBaseFc: e.entity.taxBaseFc,
                  registrationMonth: registrationMonthOf(e.entity.registeredAt),
                  ruleCodes: ruleCodes[e.entity.id] ?? [],
                }))}
                rules={options.rules}
                month={options.month}
                today={businessDate(now)}
              />
            )}
          </div>

          <div className="rounded-lg border border-[#E3DEDE] bg-white p-3.5">
            <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
              {S.obligations}
            </p>
            {open.length === 0 ? (
              <div className="mt-2 text-[12.5px]">
                <b>{S.noObligation}</b>
                <p className="text-[#5C5456]">{S.noObligationHint}</p>
              </div>
            ) : (
              <InvoiceSelectionForm
                action={INVOICES_PDF_ROUTE}
                ids={openIds}
                labels={{
                  generate: S.generate,
                  opensInTab: S.opensInTab,
                  selectAtLeastOne: S.selectAtLeastOne,
                  selected: S.selected,
                }}
              >
                <div className="mt-1.5 overflow-x-auto">
                  <table className="w-full text-[12.5px] whitespace-nowrap">
                    <thead>
                      <tr className="text-[10.5px] tracking-wider text-[#5C5456] uppercase">
                        <th className={th}>
                          <span className="sr-only">{S.select}</span>
                        </th>
                        <th className={th}>{C.tax}</th>
                        <th className={th}>{C.period}</th>
                        <th className={`${th} text-right`}>{C.amount}</th>
                        <th className={`${th} text-right`}>{C.penalty}</th>
                        <th className={`${th} text-right`}>{S.outstanding}</th>
                        <th className={th}>{C.due}</th>
                        <th className={th}>{C.invoice}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {open.map((o) => {
                        const period = `${formatMonthFr(o.periodStart)}${
                          o.periodEnd.slice(0, 7) !== o.periodStart.slice(0, 7)
                            ? ` → ${formatMonthFr(o.periodEnd)}`
                            : ""
                        }`;
                        const outstanding = Math.max(0, o.amountFc + o.penaltyFc - o.paidFc);
                        return (
                          <tr key={o.id} className="border-t border-[#EFEAEA]">
                            <td className={td}>
                              <label className="grid h-11 w-11 place-items-center md:h-8 md:w-8">
                                <input
                                  type="checkbox"
                                  defaultChecked
                                  data-obligation={o.id}
                                  aria-label={`${S.select} ${o.ruleLabel} ${period}`}
                                  className="h-5 w-5 accent-[#C1121F]"
                                />
                              </label>
                            </td>
                            <td className={td}>{o.ruleLabel}</td>
                            <td className={td}>{period}</td>
                            <td className={`${td} text-right font-mono`}>{formatFC(o.amountFc)}</td>
                            <td className={`${td} text-right font-mono`}>
                              {o.penaltyFc ? formatFC(o.penaltyFc) : t.common.none}
                            </td>
                            <td className={`${td} text-right font-mono font-semibold`}>
                              {formatFC(outstanding)}
                            </td>
                            <td className={`${td} font-mono`}>{formatDateFr(o.dueDate)}</td>
                            <td className={`${td} text-[#5C5456]`}>
                              {o.invoiceNo ? (
                                <span className="font-mono">{o.invoiceNo}</span>
                              ) : null}
                              {o.invoiceIssuedAt ? (
                                <div className="text-[11.5px]">
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
              </InvoiceSelectionForm>
            )}
          </div>
        </div>
      ) : null}

      <p className="text-[12.5px] text-[#5C5456]">
        {S.printRunHint}{" "}
        <Link href="/admin/rapports" className="text-[#C1121F] underline">
          {t.admin.nav.reports}
        </Link>
      </p>
    </>
  );
}
