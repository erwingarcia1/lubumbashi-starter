import Link from "next/link";

import { t } from "@/lib/i18n";

import { AgentHeader } from "../_components/header";

/** Served by the service worker when a page is requested offline and was never cached. */
export default function OfflineFallbackPage() {
  const S = t.agent.sync;
  return (
    <>
      <AgentHeader title={S.offline} subtitle={t.agent.appName} />
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <div className="border-warn bg-warn-soft rounded border-l-4 px-3 py-2 text-[12.5px]">
          {S.offlineFallback}
        </div>
        <Link
          href="/agent"
          className="block min-h-12 rounded-lg bg-[#C1121F] px-3.5 py-3 text-center text-[15px] font-semibold text-white"
        >
          {t.agent.tabs.home}
        </Link>
      </div>
    </>
  );
}
