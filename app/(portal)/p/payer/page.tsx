import { redirect } from "next/navigation";

import { getDb } from "@/lib/db/client";
import { formatFC } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { availableChannels } from "@/lib/payments/registry";
import { getPortalAccount } from "@/lib/portal/account";
import { requirePortalTaxpayer } from "@/lib/portal/session";
import { requestNow } from "@/lib/time";

import { PortalHeader } from "../../_components/portal-header";
import { PayFlow } from "./pay-flow";

export const dynamic = "force-dynamic";

/** Screen p-pay: self-service payment, no agent needed. */
export default async function PortalPayPage() {
  const taxpayer = await requirePortalTaxpayer();
  const account = await getPortalAccount(getDb(), taxpayer.id, requestNow());
  if (account.balance.outstandingFc <= 0) redirect("/p");
  const ruleLabel = account.open[0]?.ruleLabelFr ?? "";
  return (
    <>
      <PortalHeader
        title={t.portal.pay.title}
        subtitle={`${formatFC(account.balance.outstandingFc)} · ${ruleLabel}`}
      />
      <PayFlow
        mode={{ kind: "session" }}
        phone={account.taxpayer.phone}
        obligations={account.open.map((o) => ({
          id: o.id,
          ruleLabelFr: o.ruleLabelFr,
          periodStart: o.periodStart,
          outstandingFc: o.outstandingFc,
          late: o.late,
        }))}
        channels={availableChannels()}
        homeHref="/p"
      />
    </>
  );
}
