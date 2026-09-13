"use client";

import { useState } from "react";

import { formatDateTimeFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { getAgentDb } from "@/lib/offline/db";
import { useLastSyncAt, useOnline, useOutboxCounts, useOutboxItems } from "@/lib/offline/hooks";
import { discard, requeue, syncOutbox } from "@/lib/offline/outbox";

const S = t.agent.sync;

/** Screen a-sync: the queue is visible so the agent trusts it. */
export function SyncView() {
  const online = useOnline();
  const counts = useOutboxCounts();
  const items = useOutboxItems();
  const lastSync = useLastSyncAt();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function syncNow() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await syncOutbox(getAgentDb());
      if (r.unauthenticated) setNotice(S.reconnect);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <div
        className={`rounded-lg px-3 py-2.5 text-[13px] ${online ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}
      >
        {online ? "✓ " : "● "}
        {online ? S.online : S.offline} ·{" "}
        {S.pending.replace("{n}", counts ? String(counts.queued) : "…")}
        {counts && counts.failed > 0
          ? ` · ${S.failedCount.replace("{n}", String(counts.failed))}`
          : ""}
      </div>
      <div className="flex items-center justify-between text-[12.5px] text-[#5C5456]">
        <span>{S.lastSync}</span>
        <b>{lastSync ? formatDateTimeFr(new Date(lastSync)) : S.never}</b>
      </div>
      <button
        type="button"
        onClick={syncNow}
        disabled={busy || !online}
        className="min-h-12 rounded-lg bg-[#C1121F] px-3.5 py-3 text-[15px] font-semibold text-white disabled:opacity-60"
      >
        {busy ? S.syncing : S.syncNow}
      </button>
      {notice ? (
        <div className="border-bad bg-bad-soft text-bad rounded border-l-4 px-3 py-2 text-[12.5px]">
          {notice}
        </div>
      ) : null}

      <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-2">
        <div className="py-1.5 text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
          {S.queue}
        </div>
        {items.length === 0 ? (
          <p className="py-2 text-[12.5px] text-[#5C5456]">{S.empty}</p>
        ) : (
          items.map((i) => (
            <div key={i.id} className="border-t border-[#EFEAEA] py-2 text-[12.5px]">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{i.label}</div>
                  <div className="text-[11.5px] text-[#5C5456]">
                    {S.kinds[i.kind]} · {formatDateTimeFr(new Date(i.createdAt))}
                    {i.serverRef ? ` · ${i.serverRef}` : ""}
                    {i.photos.length > 0 ? ` · ${i.photos.length} ${S.photosPending}` : ""}
                  </div>
                </div>
                <b
                  className={
                    i.status === "done"
                      ? "text-ok"
                      : i.status === "failed"
                        ? "text-bad"
                        : "text-warn"
                  }
                >
                  {S.statuses[i.status]}
                </b>
              </div>
              {i.status === "failed" ? (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-bad flex-1 font-mono text-[11px]">{i.lastError}</span>
                  <button
                    type="button"
                    onClick={() => void requeue(getAgentDb(), i.id!)}
                    className="min-h-9 rounded-md border border-[#D5CFCF] bg-white px-3 text-[12px] font-semibold"
                  >
                    {S.requeue}
                  </button>
                  <button
                    type="button"
                    onClick={() => void discard(getAgentDb(), i.id!)}
                    className="text-bad min-h-9 rounded-md border border-[#D5CFCF] bg-white px-3 text-[12px] font-semibold"
                  >
                    {S.discard}
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
      <div className="border-warn bg-warn-soft rounded border-l-4 px-3 py-2 text-[12.5px]">
        {S.note}
      </div>
    </div>
  );
}
