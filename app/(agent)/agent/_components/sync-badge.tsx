"use client";

import { t } from "@/lib/i18n";
import { useOnline, useOutboxCounts } from "@/lib/offline/hooks";

const S = t.agent.sync;

/** "Synchronisé · 0 en attente" on the home card; "Hors ligne · 3 en attente" without network. */
export function SyncBadge() {
  const online = useOnline();
  const counts = useOutboxCounts();
  const queued = counts?.queued;
  const ok = online && queued === 0;
  return (
    <div
      className={`rounded-lg px-3 py-2.5 text-[13px] ${ok ? "bg-ok-soft text-ok" : online ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad"}`}
    >
      {ok ? "✓ " : "● "}
      {online ? S.synced : S.offline} ·{" "}
      {S.pending.replace("{n}", queued === undefined ? "…" : String(queued))}
    </div>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="bg-[#1B1B1F] px-4 py-1.5 text-center text-[11.5px] text-white">
      {S.offlineBanner}
    </div>
  );
}
