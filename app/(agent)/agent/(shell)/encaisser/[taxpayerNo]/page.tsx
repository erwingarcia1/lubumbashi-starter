import { notFound } from "next/navigation";

import { getTaxpayerDetail } from "@/lib/admin/taxpayers";
import { getDb } from "@/lib/db/client";
import { requireAgent } from "@/lib/identity/agent-session";
import { availableChannels } from "@/lib/payments/registry";
import { t } from "@/lib/i18n";

import { AgentHeader } from "../../../_components/header";
import { CollectFlow } from "./collect-flow";

export default async function CollectPage({ params }: { params: Promise<{ taxpayerNo: string }> }) {
  const session = await requireAgent();
  const { taxpayerNo } = await params;
  const d = await getTaxpayerDetail(getDb(), taxpayerNo);
  if (!d) notFound();
  return (
    <>
      <AgentHeader
        title={t.agent.pay.title}
        subtitle={`${d.taxpayer.fullName} · ${taxpayerNo.slice(-5)}`}
      />
      <CollectFlow
        taxpayerNo={taxpayerNo}
        taxpayerName={d.taxpayer.fullName}
        phone={d.taxpayer.phone}
        outstandingFc={d.balance.outstandingFc}
        channels={availableChannels()}
        agentMatricule={session.matricule}
      />
    </>
  );
}
