import { and, desc, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { agentPositions, agents, auditLog, devices, obligations, taxpayers } from "@/lib/db/schema";
import { guardCollectionPosition } from "@/lib/geo/collection";
import { fenceFor } from "@/lib/geo/fence";
import { purgePositions } from "@/lib/jobs/positions";
import { initiatePayment } from "@/lib/payments/service";
import { businessDate } from "@/lib/time";
import { activitySummary, lastPositionsForDay, trailFor } from "@/lib/tracking/activity";
import { ingestPositions, type PositionInput } from "@/lib/tracking/ingest";
import { runSeed } from "@/scripts/seed";

import { appDb } from "./db";

const FAR = { lng: 27.9, lat: -11.9 };
const BEL_AIR = { lng: 27.493, lat: -11.6642 };
let agent: { agentId: string; matricule: string; deviceId: string };

describe("field tracking and geofence (D37, D38)", () => {
  beforeAll(async () => {
    const db = appDb();
    await runSeed(db);
    const [a] = await db.select().from(agents).where(eq(agents.matricule, "AG-KAM-007"));
    const [d] = await db.select().from(devices).where(eq(devices.deviceCode, "DEV-3F9A"));
    agent = { agentId: a!.id, matricule: a!.matricule, deviceId: d!.id };
  }, 120_000);

  it("AG-KAM-007 is fenced by the Bel-Air circle (1 500 m), not the commune", async () => {
    const fence = await fenceFor(appDb(), agent.agentId);
    expect(fence).toMatchObject({ zoneName: "Bel-Air", level: "quartier", radiusM: 1_500 });
    expect(fence?.center.lat).toBeCloseTo(-11.6645, 3);
  });

  it("ingest keeps day-time fixes and ignores night and stale ones", async () => {
    const db = appDb();
    const today = businessDate(new Date());
    const now = new Date(`${today}T12:00:00+02:00`);
    const kept = new Date(`${today}T11:30:00+02:00`);
    const r = await ingestPositions(
      db,
      agent,
      [
        { recordedAt: `${today}T03:00:00+02:00`, lng: 27.4933, lat: -11.6663, accuracyM: 7 },
        {
          recordedAt: new Date(now.getTime() - 25 * 3_600_000).toISOString(),
          lng: 27.4933,
          lat: -11.6663,
        },
        { recordedAt: kept.toISOString(), lng: 27.4933, lat: -11.6663, accuracyM: 7.4 },
      ],
      now,
    );
    expect(r).toEqual({ accepted: 1, ignored: 2 });
    const rows = await db
      .select()
      .from(agentPositions)
      .where(and(eq(agentPositions.agentId, agent.agentId), eq(agentPositions.recordedAt, kept)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ deviceId: agent.deviceId, accuracyM: 7, source: "ping" });
    expect(rows[0]!.businessDate).toBe(today);
    await db.delete(agentPositions).where(eq(agentPositions.id, rows[0]!.id));
  });

  it("ingest stores nothing but pings, whatever the phone claims", async () => {
    const db = appDb();
    const today = businessDate(new Date());
    const now = new Date(`${today}T12:00:00+02:00`);
    const at = new Date(`${today}T11:31:07+02:00`);
    // The API refuses this body (strict schema); the writer is guarded on its own as well.
    const smuggled = {
      recordedAt: at.toISOString(),
      lng: 27.4933,
      lat: -11.6663,
      source: "census",
    } as unknown as PositionInput;
    expect(await ingestPositions(db, agent, [smuggled], now)).toEqual({ accepted: 1, ignored: 0 });
    const rows = await db
      .select()
      .from(agentPositions)
      .where(and(eq(agentPositions.agentId, agent.agentId), eq(agentPositions.recordedAt, at)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("ping");
    // So the trail counts it as a position, never as a registration.
    const point = (await trailFor(db, agent.agentId, today)).find(
      (p) => p.origin === "position" && p.at.getTime() === at.getTime(),
    );
    expect(point?.kind).toBe("ping");
    await db.delete(agentPositions).where(eq(agentPositions.id, rows[0]!.id));
  });

  it("the seeded morning trail gives a distance, two census fixes, a long stop and a last position", async () => {
    const db = appDb();
    const today = businessDate(new Date());
    const trail = await trailFor(db, agent.agentId, today);
    const positions = trail.filter((p) => p.origin === "position");
    expect(positions.length).toBeGreaterThanOrEqual(21);
    expect(positions.filter((p) => p.kind === "census")).toHaveLength(2);
    for (let i = 1; i < trail.length; i++)
      expect(trail[i]!.at.getTime()).toBeGreaterThanOrEqual(trail[i - 1]!.at.getTime());
    const s = activitySummary(trail, await fenceFor(db, agent.agentId));
    expect(s.distanceM).toBeGreaterThan(500);
    expect(s.registrations + s.collections).toBeGreaterThanOrEqual(2);
    expect(s.stops.some((st) => st.minutes >= 90)).toBe(true); // 09:29 → 11:05 in the seed
    expect(s.lastPosition).not.toBeNull();
    const last = await lastPositionsForDay(db, today);
    expect(last.find((l) => l.matricule === "AG-KAM-007")).toMatchObject({
      fullName: expect.any(String),
    });
  });

  it("purge removes positions older than 90 business days only", async () => {
    const db = appDb();
    const now = new Date();
    const dayAt = (daysAgo: number) =>
      new Date(`${businessDate(new Date(now.getTime() - daysAgo * 86_400_000))}T10:00:00+02:00`);
    const [old, recent] = await db
      .insert(agentPositions)
      .values([
        { agentId: agent.agentId, recordedAt: dayAt(100), location: { x: 27.49, y: -11.66 } },
        { agentId: agent.agentId, recordedAt: dayAt(10), location: { x: 27.49, y: -11.66 } },
      ])
      .returning({ id: agentPositions.id });
    const r = await purgePositions(db, 90, now);
    expect(r.deleted).toBeGreaterThanOrEqual(1);
    expect(r.before).toBe(businessDate(new Date(now.getTime() - 90 * 86_400_000)));
    const ids = (
      await db
        .select({ id: agentPositions.id })
        .from(agentPositions)
        .where(sql`${agentPositions.id} in (${old!.id}, ${recent!.id})`)
    ).map((x) => x.id);
    expect(ids).toEqual([recent!.id]);
    await db.delete(agentPositions).where(eq(agentPositions.id, recent!.id));
  });

  it("a collection far from Bel-Air is refused and audited; inside it reaches initiatePayment", async () => {
    const db = appDb();
    const outside = await guardCollectionPosition(db, agent, "LUB-KAM-00000126", FAR);
    expect(outside).toMatchObject({ ok: false, code: "outside_zone", zone: "Bel-Air" });
    if (outside.ok || outside.code !== "outside_zone") throw new Error("unreachable");
    expect(outside.distanceM).toBeGreaterThan(40_000);
    const [row] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "payment.refused"),
          eq(auditLog.objectId, "LUB-KAM-00000126"),
          eq(auditLog.actorId, agent.agentId),
        ),
      )
      .orderBy(desc(auditLog.id))
      .limit(1);
    expect(row).toMatchObject({
      actorType: "agent",
      actorLabel: "AG-KAM-007",
      objectType: "taxpayer",
      deviceId: agent.deviceId,
    });
    expect(row!.details).toMatchObject({
      reason: "outside_zone",
      zone: "Bel-Air",
      allowedM: 1_500,
    });
    expect(row!.gps).toEqual({ x: FAR.lng, y: FAR.lat });
    // The refusal shows in the day's trail as a refused act.
    const trail = await trailFor(db, agent.agentId, businessDate(new Date()));
    expect(trail.some((p) => p.kind === "refused" && p.objectId === "LUB-KAM-00000126")).toBe(true);

    // No position: accepted outside production, refused (and audited) in production.
    expect(await guardCollectionPosition(db, agent, "LUB-KAM-00000126", undefined)).toMatchObject({
      ok: true,
      positionMissing: true,
    });
    expect(
      await guardCollectionPosition(db, agent, "LUB-KAM-00000126", undefined, {
        APP_ENV: "production",
      }),
    ).toEqual({ ok: false, code: "position_required" });

    // Inside: nothing audited by the guard; initiatePayment creates the attempt as usual.
    const inside = await guardCollectionPosition(db, agent, "LUB-KAM-00000127", BEL_AIR);
    expect(inside).toMatchObject({ ok: true, positionMissing: false });
    if (!inside.ok) throw new Error("unreachable");
    expect(inside.distanceM).toBeLessThan(1_500);
    const [tp] = await db
      .select()
      .from(taxpayers)
      .where(eq(taxpayers.taxpayerNo, "LUB-KAM-00000127"));
    const [template] = await db
      .select()
      .from(obligations)
      .where(eq(obligations.taxpayerId, tp!.id))
      .limit(1);
    const year = 2100 + Math.floor(Math.random() * 800);
    const [fresh] = await db
      .insert(obligations)
      .values({
        entityId: template!.entityId,
        taxpayerId: tp!.id,
        taxRuleId: template!.taxRuleId,
        taxRuleVersionId: template!.taxRuleVersionId,
        periodStart: `${year}-03-01`,
        periodEnd: `${year}-03-31`,
        dueDate: `${year}-03-31`,
        amountFc: 5_000,
      })
      .returning();
    const view = await initiatePayment(
      db,
      { type: "agent", ...agent, gps: BEL_AIR },
      { taxpayerNo: "LUB-KAM-00000127", channel: "mpesa", obligationIds: [fresh!.id] },
    );
    expect(view.reference).toMatch(/^TX-\d{4}-\d{2}-\d{4}-[A-Z2-9]{4}$/);
    expect(["initiated", "pending"]).toContain(view.status);
    expect(view.amountFc).toBe(5_000);
  });
});
