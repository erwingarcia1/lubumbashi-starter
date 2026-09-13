"use client";

import { useEffect, useRef } from "react";

import { getAgentDb } from "@/lib/offline/db";
import { pruneDone, syncOutbox } from "@/lib/offline/outbox";

const RETRY_MS = 30_000;

/**
 * Drains the offline outbox: on mount, when the network comes back, and every 30 s while items
 * wait. Mounted once in the agent shell; the UI reads the queue live through Dexie hooks.
 */
export function SyncManager() {
  const running = useRef(false);

  useEffect(() => {
    const db = getAgentDb();
    async function run() {
      if (running.current || !navigator.onLine) return;
      running.current = true;
      try {
        const queued = await db.outbox.where("status").equals("queued").count();
        if (queued > 0) await syncOutbox(db);
        await pruneDone(db);
      } catch {
        /* next trigger retries */
      } finally {
        running.current = false;
      }
    }
    const first = window.setTimeout(run, 0);
    const interval = window.setInterval(run, RETRY_MS);
    window.addEventListener("online", run);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      window.removeEventListener("online", run);
    };
  }, []);

  return null;
}
