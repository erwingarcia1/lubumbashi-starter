"use client";

import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { getAgentDb } from "@/lib/offline/db";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="min-h-12 text-[12.5px] text-[#5C5456] underline"
      onClick={async () => {
        // The position queue belongs to this session (D38): a colleague who logs in next on a
        // shared phone must not inherit it. The outbox stays: census records are synced later.
        try {
          await getAgentDb().pings.clear();
        } catch {
          /* no IndexedDB: nothing was queued */
        }
        await fetch("/api/v1/agent/logout", { method: "POST" });
        router.push("/agent/login");
        router.refresh();
      }}
    >
      {t.agent.home.signOut}
    </button>
  );
}
