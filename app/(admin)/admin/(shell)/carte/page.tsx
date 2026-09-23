import { asc, eq } from "drizzle-orm";

import { mapPoints } from "@/lib/admin/map";
import { mapView } from "@/lib/admin/map-center";
import { getDb } from "@/lib/db/client";
import { agents, zones } from "@/lib/db/schema";
import { t } from "@/lib/i18n";
import { businessDate, requestNow } from "@/lib/time";
import { lastPositionsForDay } from "@/lib/tracking/activity";
import { formatTimeFr } from "@/lib/tracking/format";

import { CoverageMapLoader } from "./coverage-map-loader";
import { MapFilters } from "./map-filters";

/** d-map: every registered point coloured by status; "non visités" waits for cadastre data (D6). */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ commune?: string; statut?: string; agent?: string; agents?: string }>;
}) {
  const sp = await searchParams;
  const db = getDb();
  const pill =
    sp.statut === "paid" || sp.statut === "due" || sp.statut === "late" ? sp.statut : undefined;
  const [communes, agentRows] = await Promise.all([
    db
      .select({ code: zones.code, name: zones.name })
      .from(zones)
      .where(eq(zones.level, "commune"))
      .orderBy(asc(zones.name)),
    db.select({ matricule: agents.matricule }).from(agents).orderBy(asc(agents.matricule)),
  ]);
  // Default: the pilot commune. "" (Toutes les communes) or a code that no longer exists (stale
  // bookmark, D24 recoding) removes the filter, so heading, select and map always agree.
  const wanted = sp.commune === undefined ? "KAM" : sp.commune.trim().toUpperCase();
  const communeCode = communes.some((c) => c.code === wanted) ? wanted : undefined;
  const points = await mapPoints(db, {
    communeCode,
    agentMatricule: sp.agent || undefined,
    pill,
  });
  // Agents layer (D38): each agent's last position of the current business day.
  const showAgents = sp.agents === "1";
  const agentMarkers = showAgents
    ? (await lastPositionsForDay(db, businessDate(requestNow()))).map((a) => ({
        matricule: a.matricule,
        fullName: a.fullName,
        lng: a.lng,
        lat: a.lat,
        seenAt: formatTimeFr(a.at),
      }))
    : [];
  const M = t.admin.map;
  const T = t.admin.tracking;
  const communeName = communeCode
    ? (communes.find((c) => c.code === communeCode)?.name ?? communeCode)
    : M.allCommunes;
  const view = mapView(points, communeCode);
  const counts = {
    paid: points.filter((p) => p.pill === "paid").length,
    due: points.filter((p) => p.pill === "due").length,
    late: points.filter((p) => p.pill === "late").length,
  };
  const sel =
    "h-11 w-full min-w-0 rounded-md border border-[#D5CFCF] bg-white px-2 md:h-8 md:w-auto";
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">
          {M.title} · {communeName}
        </h2>
        {/* Keyed on the filters: a soft navigation (sidebar "Carte") must reset the uncontrolled selects. */}
        <MapFilters
          key={`${communeCode ?? ""}|${sp.statut ?? ""}|${sp.agent ?? ""}|${showAgents ? 1 : 0}`}
          className="grid w-full grid-cols-2 gap-2 text-base md:ml-auto md:flex md:w-auto md:flex-wrap md:gap-1.5 md:text-[12px]"
        >
          <select
            name="commune"
            defaultValue={communeCode ?? ""}
            aria-label={M.commune}
            className={sel}
          >
            <option value="">{M.allCommunes}</option>
            {communes.map((z) => (
              <option key={z.code} value={z.code}>
                {z.name}
              </option>
            ))}
          </select>
          <select
            name="statut"
            defaultValue={sp.statut ?? ""}
            aria-label={M.status}
            className={sel}
          >
            <option value="">
              {M.status} : {t.common.all}
            </option>
            <option value="paid">{t.status.pill.paid}</option>
            <option value="due">{t.status.pill.due}</option>
            <option value="late">{t.status.pill.late}</option>
          </select>
          <select name="agent" defaultValue={sp.agent ?? ""} aria-label={M.agent} className={sel}>
            <option value="">
              {M.agent} : {t.common.all}
            </option>
            {agentRows.map((a) => (
              <option key={a.matricule} value={a.matricule}>
                {a.matricule}
              </option>
            ))}
          </select>
          <select
            name="agents"
            defaultValue={showAgents ? "1" : ""}
            aria-label={T.layer.label}
            className={sel}
          >
            <option value="">{T.layer.off}</option>
            <option value="1">{T.layer.on}</option>
          </select>
          <button
            type="submit"
            className="h-11 w-full rounded-md border border-[#D5CFCF] bg-white px-3 font-semibold md:h-8 md:w-auto"
          >
            {t.common.search}
          </button>
        </MapFilters>
      </div>
      <CoverageMapLoader
        points={points}
        view={view}
        maptilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY ?? null}
        agentMarkers={agentMarkers}
      />
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          [M.kpis.paid, counts.paid, "text-ok"],
          [M.kpis.due, counts.due, "text-warn"],
          [M.kpis.late, counts.late, "text-[#C1121F]"],
          [M.kpis.nv, "—", "text-[#8E8688]"],
        ].map(([l, v, cls]) => (
          <div
            key={String(l)}
            className="min-w-0 rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3 break-words"
          >
            <div className="text-[11.5px] font-semibold tracking-wide text-[#5C5456] uppercase">
              {l}
            </div>
            <div className={`text-[22px] font-bold tabular-nums ${cls}`}>{v}</div>
            {l === M.kpis.nv ? (
              <div className="text-[11.5px] text-[#5C5456]">{M.nvNote}</div>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}
