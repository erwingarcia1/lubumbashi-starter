import Link from "next/link";

import { getDb } from "@/lib/db/client";
import { formatDateFr, formatFC, formatMonthFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { getPortalAccount } from "@/lib/portal/account";
import { requirePortalTaxpayer } from "@/lib/portal/session";
import { requestNow } from "@/lib/time";

import { PortalHeader } from "../_components/portal-header";

export const dynamic = "force-dynamic";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Screen p-home: what I owe, why, one button; my receipts; a way to complain. */
export default async function PortalHomePage() {
  const taxpayer = await requirePortalTaxpayer();
  const account = await getPortalAccount(getDb(), taxpayer.id, requestNow());
  const H = t.portal.home;
  const summary = account.open
    .map(
      (o) =>
        `${formatMonthFr(o.periodStart)}${o.late ? ` (${t.status.pill.late.toLowerCase()})` : ""}`,
    )
    .join(" + ");
  const ruleLabel = account.open[0]?.ruleLabelFr ?? "";
  return (
    <>
      <PortalHeader title={t.receipt.city} subtitle={t.portal.brand} />
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <div>
          <div className="text-[16px] font-bold">
            {H.hello} {account.taxpayer.fullName}
          </div>
          <div className="text-[12.5px] text-[#5C5456]">
            <span className="font-mono">{account.taxpayer.taxpayerNo}</span> ·{" "}
            {account.taxpayer.address}
          </div>
        </div>

        <div className="rounded-lg border border-[#E3DEDE] bg-white p-3.5">
          {account.balance.outstandingFc > 0 ? (
            <>
              <div className="text-[12.5px] text-[#5C5456]">{H.youOwe}</div>
              <div className="font-mono text-[28px] font-bold text-[#C1121F]">
                {formatFC(account.balance.outstandingFc)}
              </div>
              <div className="text-[12.5px] text-[#5C5456]">
                {ruleLabel} · {summary}
              </div>
              <Link
                href="/p/payer"
                className="mt-3 block min-h-12 rounded-lg bg-[#C1121F] px-3.5 py-3 text-center text-[15px] font-semibold text-white"
              >
                {H.payNow}
              </Link>
            </>
          ) : (
            <>
              <div className="text-ok text-[16px] font-bold">{H.nothingDue}</div>
              <div className="text-[12.5px] text-[#5C5456]">{ruleLabel || t.common.none}</div>
            </>
          )}
        </div>

        {account.open.length > 0 ? (
          <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-2">
            <div className="py-1.5 text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
              {H.detail}
            </div>
            {account.open.map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between gap-2 border-t border-[#EFEAEA] py-2 text-[12.5px]"
              >
                <div>
                  <div className="font-semibold">{capitalize(formatMonthFr(o.periodStart))}</div>
                  <div className={o.late ? "text-bad" : "text-[#5C5456]"}>
                    {o.late ? H.late : H.due} {formatDateFr(o.dueDate)}
                  </div>
                </div>
                <div className="text-right">
                  <b className="font-mono">{formatFC(o.outstandingFc)}</b>
                  {o.invoiceNo && o.invoiceToken ? (
                    <Link
                      href={`/f/${o.invoiceNo}/${o.invoiceToken}` as never}
                      className="block text-[11px] text-[#5C5456] underline"
                    >
                      {t.portal.invoice.title}
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-2">
          <div className="py-1.5 text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
            {H.receipts}
          </div>
          {account.receipts.length === 0 ? (
            <p className="py-2 text-[12.5px] text-[#5C5456]">{H.noReceipts}</p>
          ) : (
            account.receipts.map((r) => (
              <div
                key={r.receiptNo}
                className="flex items-center justify-between gap-2 border-t border-[#EFEAEA] py-2 text-[12.5px]"
              >
                <div>
                  <div className="font-semibold">
                    {formatDateFr(r.issuedAt)} · {formatFC(r.amountFc)}
                  </div>
                  <div className="font-mono text-[11.5px] text-[#5C5456]">
                    {r.receiptNo} ·{" "}
                    {t.status.channel[r.channel as keyof typeof t.status.channel] ?? r.channel}
                    {r.status === "cancelled" ? ` · ${t.status.receipt.cancelled}` : ""}
                  </div>
                </div>
                <a
                  href={`/api/v1/receipts/${r.receiptNo}/pdf?token=${r.verifyToken}`}
                  target="_blank"
                  rel="noreferrer"
                  className="min-h-12 content-center px-2 text-[13px] font-semibold text-[#C1121F]"
                >
                  {H.download}
                </a>
              </div>
            ))
          )}
        </div>

        <div className="rounded-lg border border-[#E3DEDE] bg-white p-3.5 text-[12.5px]">
          <b>{H.question}</b>
          <Link
            href="/p/signaler"
            className="mt-2 block min-h-12 rounded-lg border border-[#D5CFCF] bg-white px-3.5 py-3 text-center text-[15px] font-semibold"
          >
            {H.report}
          </Link>
        </div>
      </div>
    </>
  );
}
