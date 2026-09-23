import type { ReactNode } from "react";

import { requireAgent } from "@/lib/identity/agent-session";

import { PositionReporter } from "../_components/position-reporter";
import { OfflineBanner } from "../_components/sync-badge";
import { SyncManager } from "../_components/sync-manager";
import { TabBar } from "../_components/tab-bar";

export default async function AgentShellLayout({ children }: { children: ReactNode }) {
  await requireAgent();
  return (
    <>
      <OfflineBanner />
      <SyncManager />
      <PositionReporter />
      <div className="flex flex-1 flex-col">{children}</div>
      <TabBar />
    </>
  );
}
