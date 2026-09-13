"use client";

import "leaflet/dist/leaflet.css";

import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";

import type { MapPoint } from "@/lib/admin/map";

const COLORS = { paid: "#1E7F4F", due: "#B7791F", late: "#C1121F" } as const;

export function CoverageMap({
  points,
  center,
  zoom,
  maptilerKey,
  labels,
  noKeyNote,
  emptyNote,
}: {
  points: MapPoint[];
  center: [number, number];
  zoom: number;
  maptilerKey: string | null;
  labels: { paid: string; due: string; late: string; nv: string };
  noKeyNote: string;
  emptyNote: string;
}) {
  const tiles = maptilerKey
    ? `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${maptilerKey}`
    : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const attribution = maptilerKey
    ? '&copy; <a href="https://www.maptiler.com/">MapTiler</a> &copy; OpenStreetMap contributors'
    : "&copy; OpenStreetMap contributors";
  return (
    <div
      className="relative overflow-hidden rounded-lg border border-[#D9E2DB]"
      data-testid="coverage-map"
    >
      <MapContainer
        key={`${center[0]},${center[1]},${zoom}`}
        center={center}
        zoom={zoom}
        scrollWheelZoom
        className="h-[340px] w-full"
      >
        <TileLayer url={tiles} attribution={attribution} />
        {points.map((p) => (
          <CircleMarker
            key={p.taxpayerNo}
            center={[p.lat, p.lng]}
            radius={6}
            pathOptions={{ color: "#fff", weight: 1.5, fillColor: COLORS[p.pill], fillOpacity: 1 }}
          >
            <Popup>
              <b>{p.name}</b>
              <br />
              <span style={{ fontFamily: "monospace" }}>{p.taxpayerNo}</span>
              <br />
              <a href={`/admin/contribuables/${p.taxpayerNo}`}>
                {p.quartier ?? ""}
                {p.agent ? ` · ${p.agent}` : ""}
              </a>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      <div className="absolute right-2.5 bottom-2.5 z-[1000] grid gap-1 rounded-md bg-white px-2.5 py-2 text-[11px]">
        {(["paid", "due", "late"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <i
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: COLORS[k] }}
            />
            {labels[k]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-full bg-[#8E8688]" />
          {labels.nv}
        </span>
      </div>
      {!maptilerKey ? (
        <div className="absolute top-2.5 left-2.5 z-[1000] rounded bg-white/90 px-2 py-1 text-[11px] text-[#5C5456]">
          {noKeyNote}
        </div>
      ) : null}
      {points.length === 0 ? (
        <div
          role="status"
          className="absolute top-1/2 left-1/2 z-[1000] -translate-x-1/2 -translate-y-1/2 rounded-md bg-white/95 px-4 py-2.5 text-[13px] font-semibold text-[#5C5456] shadow"
        >
          {emptyNote}
        </div>
      ) : null}
    </div>
  );
}
