import { t } from "@/lib/i18n";

import { AgentHeader } from "../../_components/header";
import { SyncView } from "./sync-view";

export default function SyncPage() {
  return (
    <>
      <AgentHeader title={t.agent.sync.title} subtitle={t.agent.sync.subtitle} />
      <SyncView />
    </>
  );
}
