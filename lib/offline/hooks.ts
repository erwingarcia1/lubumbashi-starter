"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";

import { getAgentDb } from "./db";
import { LAST_SYNC_KEY } from "./outbox";

/** navigator.onLine plus the online/offline events; true during SSR and the first render. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const tid = window.setTimeout(update, 0);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.clearTimeout(tid);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export interface OutboxCounts {
  queued: number;
  failed: number;
  done: number;
}

/** null until IndexedDB has answered, so screens never show a false "0 en attente". */
export function useOutboxCounts(): OutboxCounts | null {
  return (
    useLiveQuery(async () => {
      const db = getAgentDb();
      const [queued, failed, done] = await Promise.all([
        db.outbox.where("status").equals("queued").count(),
        db.outbox.where("status").equals("failed").count(),
        db.outbox.where("status").equals("done").count(),
      ]);
      return { queued, failed, done };
    }) ?? null
  );
}

export function useOutboxItems() {
  return useLiveQuery(() => getAgentDb().outbox.orderBy("createdAt").reverse().toArray()) ?? [];
}

export function useLastSyncAt(): string | null {
  return (
    useLiveQuery(async () => {
      const row = await getAgentDb().cache.get(LAST_SYNC_KEY);
      return typeof row?.value === "string" ? row.value : null;
    }) ?? null
  );
}
