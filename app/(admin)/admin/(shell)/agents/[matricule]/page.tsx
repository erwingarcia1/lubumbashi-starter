import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getDb } from "@/lib/db/client";
import { agents, zones } from "@/lib/db/schema";
import { fenceFor, haversineM } from "@/lib/geo/fence";
import { canViewTracking } from "@/lib/identity/roles";
import { requireAdmin } from "@/lib/identity/session";
import { formatDateFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { businessDate, daysBetween, requestNow } from "@/lib/time";
import { activitySummary, trailFor, type TrailKind } from "@/lib/tracking/activity";
import { formatKm, formatLatLng, formatTimeFr } from "@/lib/tracking/format";

import { Pill, type PillTone } from "../../../_components/pill";
import { ActivityMapLoader } from "./activity-map-loader";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KIND_TONE: Record<TrailKind, PillTone> = {
  ping: "n",
  census: "ok",
  payment: "blue",
  refused: "bad",
};

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00+02:00`);
  return businessDate(new Date(d.getTime() + delta * 86_400_000));
}

/** d-agents activity (D37/D38): where the agent went, what was done, and the zone circle. */
export default async function AgentActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ matricule: string }>;
  searchParams: Promise<{ jour?: string }>;
}) {
  const [{ matricule }, sp, session] = await Promise.all([params, searchParams, requireAdmin()]);
  if (!canViewTracking(session.role)) redirect("/admin/interdit");
  const db = getDb();
  const [agent] = await db
    .select({
      id: agents.id,
      matricule: agents.matricule,
      fullName: agents.fullName,
      status: agents.status,
      zone: zones.name,
    })
    .from(agents)
    .innerJoin(zones, eq(zones.id, agents.zoneId))
    .where(eq(agents.matricule, matricule.toUpperCase()));
  if (!agent) notFound();
  const today = businessDate(requestNow());
  const day = sp.jour && DAY.test(sp.jour) ? sp.jour : today;
  const [fence, trail] = await Promise.all([fenceFor(db, agent.id), trailFor(db, agent.id, day)]);
  const s = activitySummary(trail, fence);
  const T = t.admin.tracking;
  const A = t.admin.agents;
  const points = trail.map((p, i) => ({
    n: i + 1,
    kind: p.kind,
    lng: p.lng,
    lat: p.lat,
    time: formatTimeFr(p.at),
    accuracyM: p.accuracyM,
    objectId: p.objectId,
  }));
  const tiles: Array<[string, string, string]> = [
    [T.tiles.first, s.firstAt ? formatTimeFr(s.firstAt) : t.common.none, ""],
    [T.tiles.last, s.lastAt ? formatTimeFr(s.lastAt) : t.common.none, ""],
    [T.tiles.active, `${s.activeMinutes} ${T.minutes}`, ""],
    [T.tiles.distance, formatKm(s.distanceM), ""],
    [T.tiles.stops, String(s.stops.length), s.stops.length ? "text-warn" : ""],
    [T.tiles.registrations, String(s.registrations), "text-ok"],
    [T.tiles.collections, String(s.collections), "text-[#2F4CA3]"],
    [
      T.tiles.outside,
      `${s.outsideZonePings}${s.refusals ? ` · ${s.refusals} ${T.tiles.refusals.toLowerCase()}` : ""}`,
      s.outsideZonePings || s.refusals ? "text-[#C1121F]" : "",
    ],
  ];
  const input =
    "h-11 rounded-md border border-[#D5CFCF] bg-white px-2 text-base text-[#1B1B1F] md:h-8 md:text-[12.5px]";
  const navLink =
    "inline-flex min-h-11 items-center rounded-md border border-[#D5CFCF] bg-white px-3 text-[12.5px] font-semibold md:min-h-8";
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">
          {T.title} · {agent.matricule}
        </h2>
        <span className="text-[12.5px] text-[#5C5456]">
          {agent.fullName} · {agent.zone}
          {agent.status === "suspended" ? ` · ${A.statuses.suspended}` : ""}
        </span>
        <form
          method="get"
          className="flex w-full flex-wrap items-center gap-2 text-[12.5px] md:ml-auto md:w-auto"
        >
          <label className="flex items-center gap-1.5 text-[#5C5456]">
            {T.day}
            <input type="date" name="jour" defaultValue={day} max={today} className={input} />
          </label>
          <button
            type="submit"
            className="h-11 rounded-md border border-[#D5CFCF] bg-white px-3 font-semibold md:h-8"
          >
            {T.show}
          </button>
        </form>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <Link
          href={`/admin/agents/${agent.matricule}?jour=${shiftDay(day, -1)}`}
          className={navLink}
        >
          ← {T.prevDay}
        </Link>
        <b>{formatDateFr(day)}</b>
        {daysBetween(day, today) > 0 ? (
          <Link
            href={`/admin/agents/${agent.matricule}?jour=${shiftDay(day, 1)}`}
            className={navLink}
          >
            {T.nextDay} →
          </Link>
        ) : null}
        {day !== today ? (
          <Link href={`/admin/agents/${agent.matricule}`} className={navLink}>
            {T.today}
          </Link>
        ) : null}
        <span className="text-[#5C5456]">
          {fence
            ? T.fence.replace("{zone}", fence.zoneName).replace("{radius}", String(fence.radiusM))
            : T.fenceNone}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {tiles.map(([l, v, cls]) => (
          <div
            key={l}
            className="min-w-0 rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3 break-words"
          >
            <div className="text-[11.5px] font-semibold tracking-wide text-[#5C5456] uppercase">
              {l}
            </div>
            <div className={`text-[22px] font-bold tabular-nums ${cls}`}>{v}</div>
          </div>
        ))}
      </div>
      <ActivityMapLoader
        points={points}
        fence={
          fence
            ? {
                zoneName: fence.zoneName,
                lng: fence.center.lng,
                lat: fence.center.lat,
                radiusM: fence.radiusM,
              }
            : null
        }
        maptilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY ?? null}
      />
      <p className="text-[11.5px] text-[#5C5456]">{T.hours}</p>
      <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3">
        <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
          {T.stopsTitle}
        </p>
        {s.stops.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-[#5C5456]">{T.noStops}</p>
        ) : (
          <ul className="mt-1 list-disc pl-5 text-[12.5px]">
            {s.stops.map((st) => (
              <li key={st.from.toISOString()}>
                {T.stopLine
                  .replace("{from}", formatTimeFr(st.from))
                  .replace("{to}", formatTimeFr(st.to))
                  .replace("{minutes}", String(st.minutes))}{" "}
                · <span className="font-mono">{formatLatLng(st)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-[#E3DEDE] bg-white">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] tracking-wider text-[#5C5456] uppercase">
              <th className="border-b border-[#D5CFCF] px-2.5 py-2">#</th>
              <th className="border-b border-[#D5CFCF] px-2.5 py-2">{T.timeline.time}</th>
              <th className="border-b border-[#D5CFCF] px-2.5 py-2">{T.timeline.kind}</th>
              <th className="border-b border-[#D5CFCF] px-2.5 py-2">{T.timeline.object}</th>
              <th className="border-b border-[#D5CFCF] px-2.5 py-2">{T.timeline.place}</th>
              <th className="border-b border-[#D5CFCF] px-2.5 py-2 text-right">
                {T.timeline.accuracy}
              </th>
              <th className="border-b border-[#D5CFCF] px-2.5 py-2 text-right">
                {T.timeline.fromPrevious}
              </th>
            </tr>
          </thead>
          <tbody>
            {trail.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2.5 py-3 text-[#5C5456]">
                  {T.timeline.empty}
                </td>
              </tr>
            ) : (
              trail.map((p, i) => {
                const prev = trail[i - 1];
                const outside =
                  fence && p.kind === "ping" && haversineM(fence.center, p) > fence.radiusM;
                return (
                  <tr key={i} className="border-b border-[#EFEAEA]">
                    <td className="px-2.5 py-2 font-mono">{i + 1}</td>
                    <td className="px-2.5 py-2 font-mono">{formatTimeFr(p.at)}</td>
                    <td className="px-2.5 py-2">
                      <Pill tone={KIND_TONE[p.kind]}>{T.kinds[p.kind]}</Pill>
                      {outside ? (
                        <>
                          {" "}
                          <Pill tone="bad">{T.outsideBadge}</Pill>
                        </>
                      ) : null}
                    </td>
                    <td className="px-2.5 py-2 font-mono">
                      {p.objectId && p.kind === "census" ? (
                        <Link
                          href={`/admin/contribuables/${p.objectId}`}
                          className="text-[#C1121F] underline"
                        >
                          {p.objectId}
                        </Link>
                      ) : (
                        (p.objectId ?? "")
                      )}
                    </td>
                    <td className="px-2.5 py-2 font-mono whitespace-nowrap">{formatLatLng(p)}</td>
                    <td className="px-2.5 py-2 text-right font-mono">
                      {p.accuracyM !== null ? `± ${p.accuracyM} m` : t.common.none}
                    </td>
                    <td className="px-2.5 py-2 text-right font-mono">
                      {prev ? `${Math.round(haversineM(prev, p))} m` : ""}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
