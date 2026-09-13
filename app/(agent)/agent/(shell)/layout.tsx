import type { ReactNode } from "react";

import { requireAgent } from "@/lib/identity/agent-session";

import { TabBar } from "../_components/tab-bar";

export default async function AgentShellLayout({ children }: { children: ReactNode }) {
  await requireAgent();
  return (
    <>
      <div className="flex flex-1 flex-col">{children}</div>
      <TabBar />
    </>
  );
}
