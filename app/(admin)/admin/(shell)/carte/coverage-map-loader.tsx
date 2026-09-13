"use client";

import dynamic from "next/dynamic";

import type { MapPoint } from "@/lib/admin/map";
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
  center: [number, number];
  zoom: number;
  maptilerKey: string | null;
  labels: { paid: string; due: string; late: string; nv: string };
  noKeyNote: string;
  emptyNote: string;
}) {
  return <CoverageMap {...props} />;
}
