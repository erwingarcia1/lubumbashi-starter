"use client";

import dynamic from "next/dynamic";

import { t } from "@/lib/i18n";

import type { ActivityFence, ActivityPoint } from "./activity-map";

/** Leaflet touches `window`: load it in the browser only. */
const ActivityMap = dynamic(() => import("./activity-map").then((m) => m.ActivityMap), {
  ssr: false,
  loading: () => (
    <div className="grid h-[380px] place-items-center rounded-lg border border-[#D9E2DB] bg-[#E8EFE9] text-[12.5px] text-[#4E5E52]">
      {t.common.loading}
    </div>
  ),
});

export function ActivityMapLoader(props: {
  points: ActivityPoint[];
  fence: ActivityFence | null;
  maptilerKey: string | null;
}) {
  return <ActivityMap {...props} />;
}
