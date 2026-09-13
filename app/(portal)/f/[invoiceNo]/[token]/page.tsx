import Link from "next/link";

import { qrDataUrl } from "@/lib/census/qr";
import { getDb } from "@/lib/db/client";
import { formatDateFr, formatFC, formatMonthFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { findInvoice, invoiceUrlFor } from "@/lib/portal/invoice";

import { KeyValueList, PortalHeader } from "../../../_components/portal-header";

export const dynamic = "force-dynamic";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Screen p-invoice: every avis d'imposition carries a QR unique to it. Scanning proves it comes
 * from the Mairie and opens exactly this amount for payment (public, token in the QR).
 */
export default async function InvoicePage({
  params,
}: {
  params: Promise<{ invoiceNo: string; token: string }>;
}) {
  const { invoiceNo, token } = await params;
  const inv = await findInvoice(getDb(), invoiceNo, token);
  const I = t.portal.invoice;
  if (!inv) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-[#F6F5F2] text-[#1B1B1F]">
        <PortalHeader title={I.title} subtitle={invoiceNo} />
        <div className="px-4 py-3.5">
          <div className="border-bad bg-bad-soft rounded-lg border p-3.5">
            <div className="text-bad text-[16px] font-bold">{I.notFound}</div>
            <p className="text-[12.5px] text-[#5C5456]">{I.notFoundBody}</p>
          </div>
        </div>
      </div>
    );
  }
  const o = inv.obligation;
  const outstanding = Math.max(0, o.amountFc + o.penaltyFc - o.paidFc);
  const period = capitalize(formatMonthFr(o.periodStart));
  const url = invoiceUrlFor(invoiceNo, token);
  const qr = await qrDataUrl(url);
  const payable = outstanding > 0 && (o.status === "due" || o.status === "partially_paid");
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-[#F6F5F2] text-[#1B1B1F]">
      <PortalHeader title={I.title} subtitle={`${inv.ruleLabelFr} · ${period}`} />
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <div className="border-ok flex items-center gap-2.5 rounded-lg border bg-[#F2FAF5] p-3">
          <div className="bg-ok grid h-9 w-9 place-items-center rounded-full text-[18px] text-white">
            ✓
          </div>
          <div>
            <div className="text-ok text-[15px] font-bold">{I.authentic}</div>
            <div className="text-[12px] text-[#5C5456]">{I.authenticBody}</div>
          </div>
        </div>
        <div className="rounded-md border border-dashed border-[#C9C2C2] bg-white p-3.5">
          <div className="mb-2 border-b border-[#E3DEDE] pb-2 text-center">
            <b className="block text-[13px]">{I.city}</b>
            <small className="text-[#5C5456]">{I.subtitle}</small>
          </div>
          <KeyValueList
            rows={[
              [I.taxpayer, inv.taxpayer.fullName],
              [
                I.id,
                <span key="id" className="font-mono">
                  {inv.taxpayer.taxpayerNo}
                </span>,
              ],
              [I.period, period],
              [
                I.amount,
                <span key="amount" className="font-mono">
                  {formatFC(o.amountFc + o.penaltyFc)}
                </span>,
              ],
              [I.due, formatDateFr(o.dueDate)],
              [
                I.reference,
                <span key="ref" className="font-mono">
                  {invoiceNo}
                </span>,
              ],
            ]}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={I.scan} className="mx-auto mt-3 h-[200px] w-[200px]" />
          <p className="mt-1 text-center text-[11.5px] text-[#5C5456]">
            {I.scan}
            <br />
            <span className="font-mono">{url.replace(/^https?:\/\//, "")}</span>
          </p>
        </div>
        {payable ? (
          <Link
            href={`/f/${invoiceNo}/${token}/payer` as never}
            className="block min-h-12 rounded-lg bg-[#C1121F] px-3.5 py-3 text-center text-[15px] font-semibold text-white"
          >
            {I.pay} · {formatFC(outstanding)}
          </Link>
        ) : (
          <div className="border-ok text-ok rounded-lg border bg-[#F2FAF5] p-3 text-center text-[14px] font-semibold">
            {o.status === "paid" ? I.paid : t.status.obligation[o.status]}
          </div>
        )}
      </div>
    </div>
  );
}
