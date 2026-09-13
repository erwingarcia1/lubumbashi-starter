"use client";

import dynamic from "next/dynamic";

import type { MapPoint } from "@/lib/admin/map";
import type { MapView } from "@/lib/admin/map-center";
import { t } from "@/lib/i18n";

/** Leaflet touches `window`: load it in the browser only. */
const CoverageMap = dynamic(() => import("./coverage-map").then((m) => m.CoverageMap), {
  ssr: false,
  loading: () => (
    <div className="grid h-[340px] place-items-center rounded-lg border border-[#D9E2DB] bg-[#E8EFE9] text-[12.5px] text-[#4E5E52]">
      {t.common.loading}
    </div>
  ),
});

export function CoverageMapLoader(props: {
  points: MapPoint[];
  view: MapView;
  maptilerKey: string | null;
}) {
  return <CoverageMap {...props} />;
}
