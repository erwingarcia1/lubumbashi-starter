import { notFound, redirect } from "next/navigation";

import { getDb } from "@/lib/db/client";
import { formatFC } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { availableChannels } from "@/lib/payments/registry";
import { findInvoice } from "@/lib/portal/invoice";
import { businessDate, requestNow } from "@/lib/time";

import { PortalHeader } from "../../../../_components/portal-header";
import { PayFlow } from "../../../../p/payer/pay-flow";

export const dynamic = "force-dynamic";

/** Pays exactly the scanned avis; the token in the QR is the authorization. */
export default async function InvoicePayPage({
  params,
}: {
  params: Promise<{ invoiceNo: string; token: string }>;
}) {
  const { invoiceNo, token } = await params;
  const inv = await findInvoice(getDb(), invoiceNo, token);
  if (!inv) notFound();
  const o = inv.obligation;
  const outstanding = Math.max(0, o.amountFc + o.penaltyFc - o.paidFc);
  if (outstanding <= 0) redirect(`/f/${invoiceNo}/${token}` as never);
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-[#F6F5F2] text-[#1B1B1F]">
      <PortalHeader
        title={t.portal.pay.title}
        subtitle={`${formatFC(outstanding)} · ${invoiceNo}`}
      />
      <PayFlow
        mode={{ kind: "invoice", invoiceNo, token }}
        phone={inv.taxpayer.phone}
        obligations={[
          {
            id: o.id,
            ruleLabelFr: inv.ruleLabelFr,
            periodStart: o.periodStart,
            outstandingFc: outstanding,
            late: o.dueDate < businessDate(requestNow()),
          },
        ]}
        channels={availableChannels()}
        homeHref={`/f/${invoiceNo}/${token}`}
      />
    </div>
  );
}
