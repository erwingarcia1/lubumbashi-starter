import Link from "next/link";

import { t } from "@/lib/i18n";

import { AgentHeader } from "../../../_components/header";

export default async function CollectSoonPage({
  params,
}: {
  params: Promise<{ taxpayerNo: string }>;
}) {
  const { taxpayerNo } = await params;
  return (
    <>
      <AgentHeader
        title={t.agent.profile.collect}
        subtitle={<span className="font-mono">{taxpayerNo}</span>}
      />
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <div className="border-warn bg-warn-soft rounded border-l-4 px-3 py-2 text-[12.5px]">
          {t.agent.profile.collectSoon}
        </div>
        <Link
          href={`/agent/contribuables/${taxpayerNo}` as never}
          className="block min-h-12 rounded-lg border border-[#D5CFCF] bg-white px-3.5 py-3 text-center text-[15px] font-semibold"
        >
          {t.common.back}
        </Link>
      </div>
    </>
  );
}
