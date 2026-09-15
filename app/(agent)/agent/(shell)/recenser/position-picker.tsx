"use client";

import "leaflet/dist/leaflet.css";

import { useState } from "react";
import {
  AttributionControl,
  CircleMarker,
  MapContainer,
  TileLayer,
  ZoomControl,
  useMapEvents,
} from "react-leaflet";

import { t } from "@/lib/i18n";

const R = t.agent.register;
const M = t.admin.map;
/** The city and its surroundings: the picker cannot leave Lubumbashi. */
const LUBUMBASHI_BOUNDS: [[number, number], [number, number]] = [
  [-11.95, 27.15],
  [-11.35, 27.85],
];

type Point = { lat: number; lng: number };

function TapToPlace({ onPlace }: { onPlace: (p: Point) => void }) {
  useMapEvents({ click: (e) => onPlace({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/** Hand-placed position when the device gives none (D34): tap the map, then confirm. */
export function PositionPicker({
  center,
  maptilerKey,
  onUse,
  onCancel,
}: {
  center: [number, number];
  maptilerKey: string | null;
  onUse: (p: Point) => void;
  onCancel: () => void;
}) {
  const [point, setPoint] = useState<Point | null>(null);
  const tiles = maptilerKey
    ? `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${maptilerKey}`
    : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12.5px] text-[#5C5456]">{R.gpsManualHint}</p>
      {/* isolate: Leaflet panes carry z-index 400-1000 and must stay under the tab bar. */}
      <div
        data-testid="position-picker"
        className="isolate z-0 overflow-hidden rounded-lg border border-[#D5CFCF] [&_.leaflet-bar_a]:h-12! [&_.leaflet-bar_a]:w-12! [&_.leaflet-bar_a]:leading-12!"
      >
        <MapContainer
          center={center}
          zoom={15}
          minZoom={11}
          maxBounds={LUBUMBASHI_BOUNDS}
          maxBoundsViscosity={1}
          scrollWheelZoom={false}
          zoomControl={false}
          attributionControl={false}
          className="h-64 w-full"
        >
          <TileLayer
            url={tiles}
            attribution={maptilerKey ? M.attributionMaptiler : M.attribution}
          />
          <ZoomControl zoomInTitle={M.zoomIn} zoomOutTitle={M.zoomOut} />
          <AttributionControl prefix={false} />
          <TapToPlace onPlace={setPoint} />
          {point ? (
            <CircleMarker
              center={[point.lat, point.lng]}
              radius={9}
              pathOptions={{ color: "#fff", weight: 2, fillColor: "#C1121F", fillOpacity: 1 }}
            />
          ) : null}
        </MapContainer>
      </div>
      <p className="font-mono text-[12.5px] text-[#5C5456]">
        {point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : t.common.none}
      </p>
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-12 flex-1 rounded-md border border-[#D5CFCF] bg-white text-[15px] font-semibold"
        >
          {t.common.cancel}
        </button>
        <button
          type="button"
          disabled={!point}
          onClick={() => point && onUse(point)}
          className="min-h-12 flex-[2] rounded-md bg-[#C1121F] text-[15px] font-semibold text-white disabled:opacity-50"
        >
          {R.gpsManualUse}
        </button>
      </div>
    </div>
  );
}
