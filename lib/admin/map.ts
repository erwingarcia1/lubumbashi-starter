import { sql } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import { summarizeBalance } from "@/lib/registry/balance";
import { businessDate } from "@/lib/time";

export interface MapPoint {
  taxpayerNo: string;
  name: string;
  lng: number;
  lat: number;
  pill: "paid" | "due" | "late";
  agent: string | null;
  quartier: string | null;
}

/** Every registered entity as a coloured point (d-map). Filters: commune, status, agent. */
export async function mapPoints(
  db: Db,
  f: { communeCode?: string; agentMatricule?: string; pill?: "paid" | "due" | "late" },
  now = new Date(),
): Promise<MapPoint[]> {
  const today = businessDate(now);
  const commune = f.communeCode ?? null;
  const agent = f.agentMatricule ?? null;
  const rows = (
    await db.execute<{
      taxpayer_no: string;
      name: string;
      lng: number;
      lat: number;
      agent: string | null;
      quartier: string | null;
      obligations: Array<{
        status: "due" | "partially_paid" | "paid" | "waived" | "cancelled";
        amountFc: number;
        penaltyFc: number;
        paidFc: number;
        dueDate: string;
      }>;
    }>(sql`
      select t.taxpayer_no, t.full_name as name, extensions.ST_X(e.location) as lng, extensions.ST_Y(e.location) as lat, ag.matricule as agent, q.name as quartier,
             coalesce((select json_agg(json_build_object('status', o.status, 'amountFc', o.amount_fc, 'penaltyFc', o.penalty_fc, 'paidFc', o.paid_fc, 'dueDate', o.due_date::text)) from app.obligations o where o.taxpayer_id = t.id), '[]'::json) as obligations
      from app.entities e
      join app.taxpayers t on t.id = e.taxpayer_id join app.zones z on z.id = t.commune_id
      left join app.zones q on q.id = e.quartier_id
      left join app.agents ag on ag.id = e.registered_by_agent_id
      where t.status = 'active' and e.status = 'active'
        and (${commune}::text is null or z.code = ${commune})
        and (${agent}::text is null or ag.matricule = ${agent})
      limit 5000`)
  ).rows;
  const points = rows.map<MapPoint>((r) => ({
    taxpayerNo: r.taxpayer_no,
    name: r.name,
    lng: Number(r.lng),
    lat: Number(r.lat),
    agent: r.agent,
    quartier: r.quartier,
    pill: summarizeBalance(r.obligations, today).pill,
  }));
  return f.pill ? points.filter((p) => p.pill === f.pill) : points;
}
