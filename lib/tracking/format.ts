/** Presentation helpers of the activity screens (business time zone, French decimals). */
const timeFr = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Lubumbashi",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "08:44" in Africa/Lubumbashi. */
export function formatTimeFr(at: Date): string {
  return timeFr.format(at);
}

/** Metres → "1,2 km" (one decimal, French comma; under 100 m rounds to "0,1 km" or "0 km"). */
export function formatKm(metres: number): string {
  const km = Math.round(metres / 100) / 10;
  return `${km.toFixed(1).replace(".", ",")} km`;
}

/** 6-decimal "lat, lng" for the timeline (about 10 cm; enough to paste into a map). */
export function formatLatLng(p: { lat: number; lng: number }): string {
  return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
}
