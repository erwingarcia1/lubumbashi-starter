"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import {
  AttributionControl,
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  ZoomControl,
} from "react-leaflet";

import type { MapPoint } from "@/lib/admin/map";
import { POINTS_MAX_ZOOM, type MapView } from "@/lib/admin/map-center";
import { t } from "@/lib/i18n";

const COLORS = { paid: "#1E7F4F", due: "#B7791F", late: "#C1121F" } as const;
const AGENT_COLOR = "#2F4CA3";

/** An agent's last position of the day (D38), drawn as a labelled pin. */
export interface AgentMarker {
  matricule: string;
  fullName: string;
  lng: number;
  lat: number;
  /** "HH:MM" in business time. */
  seenAt: string;
}

function agentIcon(matricule: string): L.DivIcon {
  const short = matricule.slice(-3);
  return L.divIcon({
    className: "agent-icon",
    iconSize: [34, 20],
    iconAnchor: [17, 10],
    popupAnchor: [0, -10],
    html: `<span style="display:grid;place-items:center;width:34px;height:20px;border-radius:10px;background:${AGENT_COLOR};color:#fff;font:700 10px/1 ui-monospace,monospace;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${short}</span>`,
  });
}
/** The city and its surroundings: the map cannot be panned or zoomed beyond this. */
const LUBUMBASHI_BOUNDS: [[number, number], [number, number]] = [
  [-11.95, 27.15],
  [-11.35, 27.85],
];

export function CoverageMap({
  points,
  view,
  maptilerKey,
  agentMarkers = [],
}: {
  points: MapPoint[];
  view: MapView;
  maptilerKey: string | null;
  agentMarkers?: AgentMarker[];
}) {
  const M = t.admin.map;
  const T = t.admin.tracking;
  const tiles = maptilerKey
    ? `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${maptilerKey}`
    : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  // Leaflet's own controls ship English titles ("Zoom in", "Close popup", the Leaflet link):
  // replaced by ours (invariant 8).
  const frame =
    view.kind === "bounds"
      ? {
          bounds: view.bounds,
          boundsOptions: { padding: [24, 24] as [number, number], maxZoom: POINTS_MAX_ZOOM },
        }
      : { center: view.center, zoom: view.zoom };
  return (
    <div
      className="relative isolate z-0 overflow-hidden rounded-lg border border-[#D9E2DB] max-md:[&_.leaflet-bar_a]:h-11! max-md:[&_.leaflet-bar_a]:w-11! max-md:[&_.leaflet-bar_a]:leading-11!"
      data-testid="coverage-map"
    >
      <MapContainer
        key={JSON.stringify(view)}
        {...frame}
        // The page scrolls; a trackpad swipe over the map must not zoom it out to the world.
        scrollWheelZoom={false}
        minZoom={11}
        maxBounds={LUBUMBASHI_BOUNDS}
        maxBoundsViscosity={1}
        zoomControl={false}
        attributionControl={false}
        className="h-[340px] w-full"
      >
        <TileLayer url={tiles} attribution={maptilerKey ? M.attributionMaptiler : M.attribution} />
        <ZoomControl zoomInTitle={M.zoomIn} zoomOutTitle={M.zoomOut} />
        <AttributionControl prefix={false} />
        {points.map((p) => (
          <CircleMarker
            key={p.taxpayerNo}
            center={[p.lat, p.lng]}
            radius={6}
            pathOptions={{ color: "#fff", weight: 1.5, fillColor: COLORS[p.pill], fillOpacity: 1 }}
          >
            <Popup closeButton={false}>
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
        {agentMarkers.map((a) => (
          <Marker
            key={a.matricule}
            position={[a.lat, a.lng]}
            icon={agentIcon(a.matricule)}
            zIndexOffset={1000}
          >
            <Popup closeButton={false}>
              <b style={{ fontFamily: "monospace" }}>{a.matricule}</b>
              <br />
              {a.fullName}
              <br />
              {T.layer.seenAt} {a.seenAt} · <a href={`/admin/agents/${a.matricule}`}>{T.link}</a>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <div className="absolute right-2.5 bottom-6 z-[1000] flex max-w-[calc(100%-1.25rem)] flex-wrap justify-end gap-x-3 gap-y-1 rounded-md bg-white px-2.5 py-2 text-[11px] md:grid md:justify-normal md:gap-1">
        {(["paid", "due", "late"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <i
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: COLORS[k] }}
            />
            {M.legend[k]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-full bg-[#8E8688]" />
          {M.legend.nv}
        </span>
        {agentMarkers.length > 0 ? (
          <span className="flex items-center gap-1.5">
            <i
              className="inline-block h-2.5 w-4 rounded-full"
              style={{ background: AGENT_COLOR }}
            />
            {T.layer.legend}
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
          {M.empty}
        </div>
      ) : null}
    </div>
  );
}
