import { sql } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import { checkInside, haversineM, type Fence } from "@/lib/geo/fence";

export type TrailKind = "ping" | "census" | "payment" | "refused";

/** One point of an agent's day: a position ping, or an audited act that carried a GPS. */
export interface TrailPoint {
  at: Date;
  kind: TrailKind;
  lng: number;
  lat: number;
  accuracyM: number | null;
  /** Audit action for an act (`taxpayer.registered`, `payment.initiated`, `payment.refused`). */
  label: string | null;
  /** Taxpayer number or payment reference of an act. */
  objectId: string | null;
  origin: "position" | "audit";
}

type TrailRow = {
  agent_id: string;
  at: Date | string;
  kind: string;
  lng: number | string;
  lat: number | string;
  accuracy_m: number | string | null;
  label: string | null;
  object_id: string | null;
  origin: "position" | "audit";
};

const ACT_ACTIONS = ["taxpayer.registered", "payment.initiated", "payment.refused"] as const;

function toPoint(r: TrailRow): TrailPoint {
  return {
    at: new Date(r.at),
    kind: r.kind as TrailKind,
    lng: Number(r.lng),
    lat: Number(r.lat),
    accuracyM: r.accuracy_m === null ? null : Number(r.accuracy_m),
    label: r.label,
    objectId: r.object_id,
    origin: r.origin,
  };
}

/**
 * Every agent's trail for one business day (positions + audited acts with a GPS), in time order.
 * One query serves both the activity page (one agent) and the agents table (all of them).
 */
export async function trailsForDay(
  db: Db,
  day: string,
  agentId?: string,
): Promise<Map<string, TrailPoint[]>> {
  const agent = agentId ?? null;
  const rows = (
    await db.execute<TrailRow>(sql`
      select * from (
        select p.agent_id, p.recorded_at as at, p.source::text as kind,
               extensions.ST_X(p.location) as lng, extensions.ST_Y(p.location) as lat,
               p.accuracy_m, null::text as label, null::text as object_id, 'position' as origin
        from app.agent_positions p
        where p.business_date = ${day}::date and (${agent}::uuid is null or p.agent_id = ${agent}::uuid)
        union all
        select a.actor_id as agent_id, a.created_at as at,
               case a.action when 'taxpayer.registered' then 'census' when 'payment.initiated' then 'payment' else 'refused' end as kind,
               extensions.ST_X(a.gps) as lng, extensions.ST_Y(a.gps) as lat,
               nullif(a.details->>'gpsAccuracyM', '')::int as accuracy_m, a.action as label, a.object_id, 'audit' as origin
        from app.audit_log a
        where a.actor_type = 'agent' and a.gps is not null and a.business_date = ${day}::date
          and a.action in (${sql.join(
            ACT_ACTIONS.map((x) => sql`${x}`),
            sql`, `,
          )})
          and (${agent}::uuid is null or a.actor_id = ${agent}::uuid)
      ) x
      order by at, origin`)
  ).rows;
  const out = new Map<string, TrailPoint[]>();
  for (const r of rows) {
    const list = out.get(r.agent_id) ?? [];
    list.push(toPoint(r));
    out.set(r.agent_id, list);
  }
  return out;
}

export async function trailFor(db: Db, agentId: string, day: string): Promise<TrailPoint[]> {
  return (await trailsForDay(db, day, agentId)).get(agentId) ?? [];
}

/** Two consecutive points closer in time than this count as continuous activity. */
export const ACTIVE_GAP_MAX_MS = 15 * 60_000;
/** A jump longer than this between consecutive points is a GPS glitch, not a journey. */
export const GLITCH_JUMP_M = 2_000;
/** A stop: at least this long without leaving a small circle and without any act. */
export const STOP_MIN_MS = 30 * 60_000;
export const STOP_RADIUS_M = 50;

export interface Stop {
  from: Date;
  to: Date;
  minutes: number;
  lng: number;
  lat: number;
}

export interface ActivitySummary {
  firstAt: Date | null;
  lastAt: Date | null;
  /** Minutes of continuous presence (sum of gaps ≤ 15 min between consecutive points). */
  activeMinutes: number;
  /** Metres walked (haversine over consecutive points, glitches skipped). */
  distanceM: number;
  stops: Stop[];
  registrations: number;
  collections: number;
  refusals: number;
  pings: number;
  outsideZonePings: number;
  lastPosition: { lng: number; lat: number; at: Date } | null;
}

const isAct = (p: TrailPoint) => p.kind !== "ping";

/** Pure: the day's figures from a time-ordered trail. */
export function activitySummary(trail: TrailPoint[], fence: Fence | null): ActivitySummary {
  const first = trail[0];
  const last = trail[trail.length - 1];
  let activeMs = 0;
  let distanceM = 0;
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1]!;
    const b = trail[i]!;
    const gap = b.at.getTime() - a.at.getTime();
    if (gap <= ACTIVE_GAP_MAX_MS) activeMs += gap;
    const d = haversineM(a, b);
    if (d <= GLITCH_JUMP_M) distanceM += d;
  }
  const stops: Stop[] = [];
  let i = 0;
  while (i < trail.length) {
    const anchor = trail[i]!;
    let j = i + 1;
    while (j < trail.length && !isAct(trail[j]!) && haversineM(anchor, trail[j]!) <= STOP_RADIUS_M)
      j++;
    const end = trail[j - 1]!;
    const ms = end.at.getTime() - anchor.at.getTime();
    if (j - 1 > i && ms >= STOP_MIN_MS) {
      stops.push({
        from: anchor.at,
        to: end.at,
        minutes: Math.round(ms / 60_000),
        lng: anchor.lng,
        lat: anchor.lat,
      });
    }
    i = j;
  }
  const pings = trail.filter((p) => p.kind === "ping");
  return {
    firstAt: first?.at ?? null,
    lastAt: last?.at ?? null,
    activeMinutes: Math.round(activeMs / 60_000),
    distanceM: Math.round(distanceM),
    stops,
    registrations: trail.filter((p) => p.kind === "census").length,
    collections: trail.filter((p) => p.kind === "payment").length,
    refusals: trail.filter((p) => p.kind === "refused").length,
    pings: pings.length,
    outsideZonePings: fence
      ? pings.filter((p) => !checkInside(fence, p, p.accuracyM).inside).length
      : 0,
    lastPosition: last ? { lng: last.lng, lat: last.lat, at: last.at } : null,
  };
}

export interface AgentLastPosition {
  agentId: string;
  matricule: string;
  fullName: string;
  lng: number;
  lat: number;
  at: Date;
  kind: TrailKind;
}

/** Where each agent was last seen on `day` (for the coverage map's "Agents" layer). */
export async function lastPositionsForDay(db: Db, day: string): Promise<AgentLastPosition[]> {
  const trails = await trailsForDay(db, day);
  if (trails.size === 0) return [];
  const ids = [...trails.keys()];
  const agents = (
    await db.execute<{ id: string; matricule: string; full_name: string }>(sql`
      select id, matricule, full_name from app.agents where id in (${sql.join(
        ids.map((x) => sql`${x}::uuid`),
        sql`, `,
      )})`)
  ).rows;
  const out: AgentLastPosition[] = [];
  for (const a of agents) {
    const trail = trails.get(a.id);
    const last = trail?.[trail.length - 1];
    if (!last) continue;
    out.push({
      agentId: a.id,
      matricule: a.matricule,
      fullName: a.full_name,
      lng: last.lng,
      lat: last.lat,
      at: last.at,
      kind: last.kind,
    });
  }
  return out.sort((x, y) => x.matricule.localeCompare(y.matricule));
}
