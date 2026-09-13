import { asc, eq } from "drizzle-orm";

import { mapPoints } from "@/lib/admin/map";
import { getDb } from "@/lib/db/client";
import { agents, zones } from "@/lib/db/schema";
import { t } from "@/lib/i18n";

import { CoverageMapLoader } from "./coverage-map-loader";

/** d-map: every registered point coloured by status; "non visités" waits for cadastre data (D6). */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ commune?: string; statut?: string; agent?: string }>;
}) {
  const sp = await searchParams;
  const db = getDb();
  const pill =
    sp.statut === "paid" || sp.statut === "due" || sp.statut === "late" ? sp.statut : undefined;
  const [communes, agentRows, points] = await Promise.all([
    db
      .select({ code: zones.code, name: zones.name })
      .from(zones)
      .where(eq(zones.level, "commune"))
      .orderBy(asc(zones.name)),
    db.select({ matricule: agents.matricule }).from(agents).orderBy(asc(agents.matricule)),
    mapPoints(db, {
      communeCode: sp.commune || "KAM",
      agentMatricule: sp.agent || undefined,
      pill,
    }),
  ]);
  const M = t.admin.map;
  const counts = {
    paid: points.filter((p) => p.pill === "paid").length,
    due: points.filter((p) => p.pill === "due").length,
    late: points.filter((p) => p.pill === "late").length,
  };
  const sel = "h-8 rounded-md border border-[#D5CFCF] bg-white px-2";
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">
          {M.title} · {communes.find((c) => c.code === (sp.commune || "KAM"))?.name ?? ""}
        </h2>
        <form method="get" className="ml-auto flex flex-wrap gap-1.5 text-[12px]">
          <select name="commune" defaultValue={sp.commune ?? "KAM"} className={sel}>
            {communes.map((z) => (
              <option key={z.code} value={z.code}>
                {z.name}
              </option>
            ))}
          </select>
          <select name="statut" defaultValue={sp.statut ?? ""} className={sel}>
            <option value="">
              {M.status} : {t.common.all}
            </option>
            <option value="paid">{t.status.pill.paid}</option>
            <option value="due">{t.status.pill.due}</option>
            <option value="late">{t.status.pill.late}</option>
          </select>
          <select name="agent" defaultValue={sp.agent ?? ""} className={sel}>
            <option value="">
              {M.agent} : {t.common.all}
            </option>
            {agentRows.map((a) => (
              <option key={a.matricule} value={a.matricule}>
                {a.matricule}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="h-8 rounded-md border border-[#D5CFCF] bg-white px-3 font-semibold"
          >
            {t.common.search}
          </button>
        </form>
      </div>
      <CoverageMapLoader
        points={points}
        maptilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY ?? null}
        labels={M.legend}
        noKeyNote={M.noKey}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
        {[
          [M.kpis.paid, counts.paid, "text-ok"],
          [M.kpis.due, counts.due, "text-warn"],
          [M.kpis.late, counts.late, "text-[#C1121F]"],
          [M.kpis.nv, "—", "text-[#8E8688]"],
        ].map(([l, v, cls]) => (
          <div key={String(l)} className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3">
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
