import { t } from "@/lib/i18n";

import { AgentHeader } from "../../_components/header";

export default function SyncPage() {
  return (
    <>
      <AgentHeader title={t.agent.sync.title} subtitle={t.agent.sync.subtitle} />
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <div className="bg-ok-soft text-ok rounded-lg px-3 py-2.5 text-[13px]">
          ✓ {t.agent.sync.online}
        </div>
        <div className="border-warn bg-warn-soft rounded border-l-4 px-3 py-2 text-[12.5px]">
          {t.agent.sync.note}
        </div>
      </div>
    </>
  );
}
