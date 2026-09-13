import Link from "next/link";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  agentRoutes,
  entities,
  obligations,
  routeAssignments,
  routeEntities,
  taxpayers,
  zones,
} from "@/lib/db/schema";
import { requireAgent } from "@/lib/identity/agent-session";
import { formatFC } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { summarizeBalance } from "@/lib/registry/balance";
import { businessDate } from "@/lib/time";

import { AgentHeader } from "../_components/header";
import { Pill } from "../../../(admin)/admin/_components/pill";
import { SignOutButton } from "./sign-out";

const tone = { paid: "ok", due: "warn", late: "bad" } as const;
const dayFr = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Lubumbashi",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const timeFr = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Lubumbashi",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export default async function AgentHomePage() {
  const session = await requireAgent();
  const db = getDb();
  const now = new Date();
  const today = businessDate(now);
  const [zone] = await db
    .select({ name: zones.name })
    .from(zones)
    .where(eq(zones.id, session.zoneId));
  const [commune] = await db
    .select({ name: zones.name })
    .from(zones)
    .where(eq(zones.id, session.communeId));
  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(taxpayers)
    .where(
      and(
        eq(taxpayers.registeredByAgentId, session.agentId),
        gte(taxpayers.registeredAt, new Date(`${today}T00:00:00+02:00`)),
      ),
    );
  const registeredToday = countRow?.n ?? 0;
  const [assignment] = await db
    .select({ routeId: routeAssignments.routeId, name: agentRoutes.name })
    .from(routeAssignments)
    .innerJoin(agentRoutes, eq(agentRoutes.id, routeAssignments.routeId))
    .where(eq(routeAssignments.agentId, session.agentId))
    .orderBy(desc(routeAssignments.assignedOn))
    .limit(1);
  const stops = assignment
    ? await db
        .select({
          position: routeEntities.position,
          taxpayerId: taxpayers.id,
          taxpayerNo: taxpayers.taxpayerNo,
          fullName: taxpayers.fullName,
          address: taxpayers.address,
        })
        .from(routeEntities)
        .innerJoin(entities, eq(entities.id, routeEntities.entityId))
        .innerJoin(taxpayers, eq(taxpayers.id, entities.taxpayerId))
        .where(eq(routeEntities.routeId, assignment.routeId))
        .orderBy(routeEntities.position)
    : [];
  const obs = stops.length
    ? await db
        .select()
        .from(obligations)
        .where(
          inArray(
            obligations.taxpayerId,
            stops.map((s) => s.taxpayerId),
          ),
        )
    : [];

  return (
    <>
      <AgentHeader
        title={session.fullName}
        subtitle={`${session.matricule} · ${commune?.name ?? ""} / ${zone?.name ?? ""}`}
        right={
          <>
            {dayFr.format(now)}
            <br />
            {timeFr.format(now)}
          </>
        }
      />
      <div className="flex flex-1 flex-col gap-3 px-4 py-3.5">
        <div className="bg-ok-soft text-ok rounded-lg px-3 py-2.5 text-[13px]">
          ✓ {t.agent.home.syncedAgo}
        </div>
        <div className="flex gap-2.5">
          <div className="flex-1 rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3">
            <div className="text-[12.5px] text-[#5C5456]">{t.agent.home.registeredToday}</div>
            <div className="text-[28px] leading-tight font-bold">{registeredToday}</div>
          </div>
          <div className="flex-1 rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3">
            <div className="text-[12.5px] text-[#5C5456]">{t.agent.home.collectedToday}</div>
            <div className="font-mono text-[20px] leading-tight font-bold">{formatFC(0)}</div>
          </div>
        </div>
        <Link
          href="/agent/scanner"
          className="block min-h-12 rounded-lg bg-[#C1121F] px-3.5 py-3 text-center text-[15px] font-semibold text-white"
        >
          ▦ {t.agent.home.scan}
        </Link>
        <Link
          href="/agent/recenser"
          className="block min-h-12 rounded-lg border border-[#D5CFCF] bg-white px-3.5 py-3 text-center text-[15px] font-semibold"
        >
          ➕ {t.agent.home.register}
        </Link>
        <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3">
          <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
            {t.agent.home.myRoute}
            {assignment ? ` · ${assignment.name}` : ""}
          </p>
          {stops.length === 0 ? (
            <p className="py-2 text-[12.5px] text-[#5C5456]">{t.agent.home.noRoute}</p>
          ) : null}
          {stops.map((s) => {
            const b = summarizeBalance(
              obs.filter((o) => o.taxpayerId === s.taxpayerId),
              today,
            );
            return (
              <Link
                key={s.taxpayerNo}
                href={`/agent/contribuables/${s.taxpayerNo}` as never}
                className="flex min-h-12 items-center gap-2.5 border-b border-[#EFEAEA] py-2.5 last:border-0"
              >
                <div className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[#F9E3E5] text-[13px] font-bold text-[#8B0F1A]">
                  {s.fullName[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold">{s.fullName}</div>
                  <div className="truncate text-[12.5px] text-[#5C5456]">
                    {s.address} · <span className="font-mono">{s.taxpayerNo.slice(-5)}</span>
                  </div>
                </div>
                <Pill tone={tone[b.pill]}>{t.status.pill[b.pill]}</Pill>
              </Link>
            );
          })}
        </div>
        <SignOutButton />
      </div>
    </>
  );
}
