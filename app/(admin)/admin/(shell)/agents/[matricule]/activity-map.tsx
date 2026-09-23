"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import {
  AttributionControl,
  Circle,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  ZoomControl,
} from "react-leaflet";

import { CITY_CENTER } from "@/lib/admin/map-center";
import { t } from "@/lib/i18n";
import type { TrailKind } from "@/lib/tracking/activity";

/** What the server page hands to the map: plain values only (dates already formatted). */
export interface ActivityPoint {
  n: number;
  kind: TrailKind;
  lng: number;
  lat: number;
  time: string;
  accuracyM: number | null;
  objectId: string | null;
}

export interface ActivityFence {
  zoneName: string;
  lng: number;
  lat: number;
  radiusM: number;
}

export const KIND_COLORS: Record<TrailKind, string> = {
  ping: "#5C5456",
  census: "#1E7F4F",
  payment: "#2F4CA3",
  refused: "#C1121F",
};

/** The city and its surroundings: the map cannot be panned or zoomed beyond this. */
const LUBUMBASHI_BOUNDS: [[number, number], [number, number]] = [
  [-11.95, 27.15],
  [-11.35, 27.85],
];

function numberedIcon(n: number, kind: TrailKind): L.DivIcon {
  const act = kind !== "ping";
  const size = act ? 26 : 20;
  return L.divIcon({
    className: "trail-icon",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    html: `<span style="display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:50%;background:${KIND_COLORS[kind]};color:#fff;font:700 ${act ? 11 : 10}px/1 ui-monospace,monospace;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${n}</span>`,
  });
}

function zoomForRadius(radiusM: number): number {
  if (radiusM <= 1_600) return 14;
  if (radiusM <= 4_500) return 13;
  return 11;
}

export function ActivityMap({
  points,
  fence,
  maptilerKey,
}: {
  points: ActivityPoint[];
  fence: ActivityFence | null;
  maptilerKey: string | null;
}) {
  const M = t.admin.map;
  const T = t.admin.tracking;
  const tiles = maptilerKey
    ? `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${maptilerKey}`
    : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  // Leaflet's own controls ship English titles ("Zoom in", "Close popup", the Leaflet link):
  // replaced by ours (invariant 8).
  const frame =
    points.length > 1
      ? {
          bounds: [
            [Math.min(...points.map((p) => p.lat)), Math.min(...points.map((p) => p.lng))],
            [Math.max(...points.map((p) => p.lat)), Math.max(...points.map((p) => p.lng))],
          ] as [[number, number], [number, number]],
          boundsOptions: { padding: [28, 28] as [number, number], maxZoom: 17 },
        }
      : points.length === 1
        ? { center: [points[0]!.lat, points[0]!.lng] as [number, number], zoom: 16 }
        : fence
          ? {
              center: [fence.lat, fence.lng] as [number, number],
              zoom: zoomForRadius(fence.radiusM),
            }
          : {
              center: [CITY_CENTER.lat, CITY_CENTER.lng] as [number, number],
              zoom: CITY_CENTER.zoom,
            };
  const line = points.map((p) => [p.lat, p.lng] as [number, number]);
  return (
    <div
      className="relative isolate z-0 overflow-hidden rounded-lg border border-[#D9E2DB] max-md:[&_.leaflet-bar_a]:h-11! max-md:[&_.leaflet-bar_a]:w-11! max-md:[&_.leaflet-bar_a]:leading-11!"
      data-testid="activity-map"
    >
      <MapContainer
        key={JSON.stringify(frame)}
        {...frame}
        scrollWheelZoom={false}
        minZoom={11}
        maxBounds={LUBUMBASHI_BOUNDS}
        maxBoundsViscosity={1}
        zoomControl={false}
        attributionControl={false}
        className="h-[380px] w-full"
      >
        <TileLayer url={tiles} attribution={maptilerKey ? M.attributionMaptiler : M.attribution} />
        <ZoomControl zoomInTitle={M.zoomIn} zoomOutTitle={M.zoomOut} />
        <AttributionControl prefix={false} />
        {fence ? (
          <Circle
            center={[fence.lat, fence.lng]}
            radius={fence.radiusM}
            pathOptions={{
              color: "#C1121F",
              weight: 1.5,
              dashArray: "6 6",
              fillColor: "#C1121F",
              fillOpacity: 0.05,
            }}
          />
        ) : null}
        {line.length > 1 ? (
          // The class must be a creation option: Leaflet's setStyle (used for pathOptions
          // updates) never touches the SVG class, so a production render would lose it.
          <Polyline
            positions={line}
            className="activity-trail"
            pathOptions={{ color: "#2F4CA3", weight: 3, opacity: 0.8 }}
          />
        ) : null}
        {points.map((p) => (
          // Pings are not focusable (a morning has dozens); acts are, and read as more than a
          // number for the screen reader.
          <Marker
            key={p.n}
            position={[p.lat, p.lng]}
            icon={numberedIcon(p.n, p.kind)}
            keyboard={p.kind !== "ping"}
            title={p.kind !== "ping" ? `${p.n}. ${T.kinds[p.kind]} · ${p.time}` : undefined}
          >
            <Popup closeButton={false}>
              <b>
                {p.n}. {T.kinds[p.kind]}
              </b>
              <br />
              {p.time}
              {p.accuracyM !== null ? ` · ± ${p.accuracyM} m` : ""}
              {p.objectId ? (
                <>
                  <br />
                  <span style={{ fontFamily: "monospace" }}>{p.objectId}</span>
                </>
              ) : null}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <div className="absolute right-2.5 bottom-6 z-[1000] flex max-w-[calc(100%-1.25rem)] flex-wrap justify-end gap-x-3 gap-y-1 rounded-md bg-white px-2.5 py-2 text-[11px] md:grid md:justify-normal md:gap-1">
        {(["ping", "census", "payment", "refused"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <i
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: KIND_COLORS[k] }}
            />
            {T.kinds[k]}
          </span>
        ))}
        {fence ? (
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-[#C1121F] bg-[#C1121F]/10" />
            {T.map.fence}
          </span>
        ) : null}
      </div>
      {!maptilerKey ? (
        <div className="pointer-events-none absolute top-2.5 left-16 z-[1000] rounded bg-white/90 px-2 py-1 text-[11px] text-[#5C5456] md:left-13">
          {M.noKey}
        </div>
      ) : null}
      {points.length === 0 ? (
        <div
          role="status"
          className="pointer-events-none absolute top-1/2 left-1/2 z-[1000] w-max max-w-[calc(100%-1.25rem)] -translate-x-1/2 -translate-y-1/2 rounded-md bg-white/95 px-4 py-2.5 text-center text-[13px] font-semibold text-[#5C5456] shadow"
        >
          {T.map.empty}
        </div>
      ) : null}
    </div>
  );
}
