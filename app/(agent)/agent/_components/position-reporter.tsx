"use client";

import { useEffect, useRef } from "react";

import { getAgentDb } from "@/lib/offline/db";
import { flushPings, PING_INTERVAL_MS, queuePing } from "@/lib/tracking/ping-queue";

const FIX_TIMEOUT_MS = 20_000;

/**
 * Shares the device position while the agent is logged in and the app is visible: a fix at
 * once, then every 3 minutes, queued in IndexedDB (`pings`, never the outbox: invariant 3) and
 * flushed when online. Mounted once in the agent shell, which only renders after requireAgent,
 * so nothing runs when the agent is logged out (D38).
 */
export function PositionReporter() {
  const busy = useRef(false);
  const lastFixAt = useRef(0);
  const loggedOut = useRef(false);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const db = getAgentDb();

    async function flush() {
      if (!navigator.onLine || loggedOut.current) return;
      try {
        const r = await flushPings(db);
        if (r.unauthenticated) loggedOut.current = true;
      } catch {
        /* next tick retries */
      }
    }

    async function capture(force = false) {
      if (busy.current || document.visibilityState !== "visible" || loggedOut.current) return;
      if (!force && Date.now() - lastFixAt.current < PING_INTERVAL_MS - 5_000) return;
      busy.current = true;
      try {
        const fix = await new Promise<GeolocationPosition | null>((resolve) =>
          navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
            timeout: FIX_TIMEOUT_MS,
            maximumAge: 60_000,
          }),
        );
        lastFixAt.current = Date.now();
        if (fix) {
          await queuePing(db, {
            recordedAt: new Date(fix.timestamp || Date.now()).toISOString(),
            lng: fix.coords.longitude,
            lat: fix.coords.latitude,
            accuracyM: Number.isFinite(fix.coords.accuracy)
              ? Math.round(fix.coords.accuracy)
              : null,
          });
        }
        await flush();
      } catch {
        /* the next interval tries again */
      } finally {
        busy.current = false;
      }
    }

    const first = window.setTimeout(() => void capture(true), 0);
    const interval = window.setInterval(() => void capture(true), PING_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void capture();
    };
    const onOnline = () => void flush();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return null;
}
