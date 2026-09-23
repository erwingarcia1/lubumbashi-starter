import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { ACCURACY_TOLERANCE_MAX_M, checkInside, haversineM, type Fence } from "@/lib/geo/fence";
import { positionRequiredForCollection } from "@/lib/geo/policy";
import { AgentDb } from "@/lib/offline/db";
import { activitySummary, type TrailPoint } from "@/lib/tracking/activity";
import { formatKm } from "@/lib/tracking/format";
import { acceptsPosition, isWithinTrackingHours, positionsInput } from "@/lib/tracking/ingest";
import { flushPings, PING_MAX_QUEUE, prunePings, queuePing } from "@/lib/tracking/ping-queue";

/** Metres per degree of latitude on the sphere used by haversineM (R = 6 371 008.8 m). */
const M_PER_DEG_LAT = (2 * Math.PI * 6_371_008.8) / 360;
const north = (p: { lng: number; lat: number }, metres: number) => ({
  lng: p.lng,
  lat: p.lat + metres / M_PER_DEG_LAT,
});
const east = (p: { lng: number; lat: number }, metres: number) => ({
  lng: p.lng + metres / (M_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180)),
  lat: p.lat,
});

const BEL_AIR: Fence = {
  zoneId: "zone",
  zoneCode: "bel-air",
  zoneName: "Bel-Air",
  level: "quartier",
  center: { lng: 27.4935, lat: -11.6645 },
  radiusM: 1_500,
};

describe("haversine distance", () => {
  it("is 0 on the same point and about 111.2 km per degree of latitude", () => {
    expect(haversineM(BEL_AIR.center, BEL_AIR.center)).toBe(0);
    const oneDegree = { lng: 27.4935, lat: -10.6645 };
    expect(haversineM(BEL_AIR.center, oneDegree)).toBeCloseTo(M_PER_DEG_LAT, -1);
    expect(haversineM(BEL_AIR.center, north(BEL_AIR.center, 250))).toBeCloseTo(250, 0);
    expect(haversineM(BEL_AIR.center, east(BEL_AIR.center, 250))).toBeCloseTo(250, 0);
  });

  it("puts the far test point (-11.9, 27.9) about 51 km from Bel-Air", () => {
    const d = haversineM(BEL_AIR.center, { lng: 27.9, lat: -11.9 });
    expect(d).toBeGreaterThan(50_000);
    expect(d).toBeLessThan(53_000);
  });
});

describe("checkInside (circle + GPS accuracy tolerance, D37)", () => {
  it("accepts inside the radius and refuses beyond it", () => {
    expect(checkInside(BEL_AIR, BEL_AIR.center)).toEqual({
      inside: true,
      distanceM: 0,
      allowedM: 1_500,
    });
    expect(checkInside(BEL_AIR, north(BEL_AIR.center, 1_400)).inside).toBe(true);
    const out = checkInside(BEL_AIR, north(BEL_AIR.center, 1_600));
    expect(out.inside).toBe(false);
    expect(out.distanceM).toBe(1_600);
  });

  it("adds the accuracy to the radius, capped at 500 m", () => {
    expect(checkInside(BEL_AIR, north(BEL_AIR.center, 1_600), 150).inside).toBe(true);
    expect(checkInside(BEL_AIR, north(BEL_AIR.center, 1_600), 50).inside).toBe(false);
    const capped = checkInside(BEL_AIR, north(BEL_AIR.center, 1_900), 5_000);
    expect(capped.allowedM).toBe(1_500 + ACCURACY_TOLERANCE_MAX_M);
    expect(capped.inside).toBe(true);
    expect(checkInside(BEL_AIR, north(BEL_AIR.center, 2_100), 5_000).inside).toBe(false);
    expect(checkInside(BEL_AIR, north(BEL_AIR.center, 1_400), -20).inside).toBe(true);
  });
});

describe("collection without a position (D37 placeholder)", () => {
  it("is refused in production only", () => {
    for (const APP_ENV of ["development", "test", "demo", undefined]) {
      expect(positionRequiredForCollection({ APP_ENV }), String(APP_ENV)).toBe(false);
    }
    expect(positionRequiredForCollection({ APP_ENV: "production" })).toBe(true);
  });
});

describe("position ingest window (D38: 06:00–20:00 Africa/Lubumbashi, 24 h)", () => {
  const cat = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+02:00`);

  it("keeps business hours only", () => {
    expect(isWithinTrackingHours(cat("2026-09-23", "05:59"))).toBe(false);
    expect(isWithinTrackingHours(cat("2026-09-23", "06:00"))).toBe(true);
    expect(isWithinTrackingHours(cat("2026-09-23", "19:59"))).toBe(true);
    expect(isWithinTrackingHours(cat("2026-09-23", "20:00"))).toBe(false);
    // 22:30 UTC is 00:30 the next day in Lubumbashi
    expect(isWithinTrackingHours(new Date("2026-09-23T22:30:00Z"))).toBe(false);
  });

  it("drops fixes older than 24 h or from the future", () => {
    const now = cat("2026-09-23", "12:00");
    expect(acceptsPosition(cat("2026-09-23", "11:00"), now)).toBe(true);
    expect(acceptsPosition(cat("2026-09-22", "11:00"), now)).toBe(false);
    expect(acceptsPosition(cat("2026-09-22", "12:30"), now)).toBe(true);
    expect(acceptsPosition(cat("2026-09-23", "12:03"), now)).toBe(true);
    expect(acceptsPosition(cat("2026-09-23", "12:10"), now)).toBe(false);
    expect(acceptsPosition(new Date("nope"), now)).toBe(false);
  });

  it("validates the request contract: at most 50 fixes, valid coordinates", () => {
    const fix = { recordedAt: "2026-09-23T09:00:00Z", lng: 27.49, lat: -11.66, accuracyM: 8 };
    expect(positionsInput.safeParse([fix]).success).toBe(true);
    expect(
      positionsInput.safeParse([{ ...fix, recordedAt: "2026-09-23T11:00:00+02:00" }]).success,
    ).toBe(true);
    expect(positionsInput.safeParse(Array.from({ length: 51 }, () => fix)).success).toBe(false);
    expect(positionsInput.safeParse([{ ...fix, lat: 95 }]).success).toBe(false);
    expect(positionsInput.safeParse([{ ...fix, recordedAt: "hier" }]).success).toBe(false);
    expect(positionsInput.safeParse([{ ...fix, source: "manual" }]).success).toBe(false);
  });
});

describe("activitySummary on a synthetic trail", () => {
  const origin = { lng: 27.4935, lat: -11.6645 };
  const at = (hhmm: string) => new Date(`2026-09-23T${hhmm}:00+02:00`);
  const pt = (
    hhmm: string,
    pos: { lng: number; lat: number },
    kind: TrailPoint["kind"] = "ping",
    objectId: string | null = null,
  ): TrailPoint => ({
    at: at(hhmm),
    kind,
    lng: pos.lng,
    lat: pos.lat,
    accuracyM: 8,
    label: kind === "ping" ? null : kind,
    objectId,
    origin: kind === "ping" ? "position" : "audit",
  });
  const trail: TrailPoint[] = [
    pt("08:00", origin),
    pt("08:03", north(origin, 100)),
    pt("08:06", north(origin, 200)),
    pt("08:09", north(origin, 250), "census", "LUB-KAM-00000200"),
    pt("08:12", north(origin, 300)),
    pt("08:15", east(origin, 5_000)), // GPS glitch: 5 km away for one fix
    pt("08:18", north(origin, 320)),
    pt("08:40", north(origin, 330)), // 22 min gap: not active time
    pt("08:50", north(origin, 325)),
    pt("09:00", north(origin, 600), "payment", "TX-2609-23-0900-ABCD"),
  ];
  const fence: Fence = { ...BEL_AIR, center: origin, radiusM: 1_000 };

  it("sums the distance without the glitch, the active minutes without long gaps", () => {
    const s = activitySummary(trail, fence);
    // 100 + 100 + 50 + 50 + (skipped 5 km out and back) + 10 + 5 + 275
    expect(s.distanceM).toBeGreaterThanOrEqual(588);
    expect(s.distanceM).toBeLessThanOrEqual(592);
    expect(s.activeMinutes).toBe(18 + 10 + 10);
    expect(s.firstAt).toEqual(at("08:00"));
    expect(s.lastAt).toEqual(at("09:00"));
    expect(s.lastPosition).toEqual({ ...north(origin, 600), at: at("09:00") });
  });

  it("counts acts and pings, and the pings outside the fence", () => {
    const s = activitySummary(trail, fence);
    expect(s.registrations).toBe(1);
    expect(s.collections).toBe(1);
    expect(s.refusals).toBe(0);
    expect(s.pings).toBe(8);
    expect(s.outsideZonePings).toBe(1);
    expect(activitySummary(trail, null).outsideZonePings).toBe(0);
  });

  it("finds a stop of 30 min or more within 50 m and no act", () => {
    const s = activitySummary(trail, fence);
    expect(s.stops).toHaveLength(1);
    expect(s.stops[0]).toMatchObject({ from: at("08:18"), to: at("08:50"), minutes: 32 });
    // The same segment with a census in the middle is not a stop.
    const busy = trail.map((p) =>
      p.at.getTime() === at("08:40").getTime() ? { ...p, kind: "census" as const } : p,
    );
    expect(activitySummary(busy, fence).stops).toHaveLength(0);
    // Two fixes 40 min apart in the same place: a stop even without intermediate pings.
    const idle = [pt("10:00", origin), pt("10:40", north(origin, 20))];
    expect(activitySummary(idle, fence).stops[0]?.minutes).toBe(40);
    expect(activitySummary(idle, fence).activeMinutes).toBe(0);
  });

  it("is empty for an empty trail", () => {
    expect(activitySummary([], fence)).toEqual({
      firstAt: null,
      lastAt: null,
      activeMinutes: 0,
      distanceM: 0,
      stops: [],
      registrations: 0,
      collections: 0,
      refusals: 0,
      pings: 0,
      outsideZonePings: 0,
      lastPosition: null,
    });
  });
});

describe("ping queue (separate Dexie table, never the outbox)", () => {
  let n = 0;
  const fetchWith = (
    handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  ): typeof fetch =>
    (async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(String(input), init)) as typeof fetch;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const ping = (minutesAgo: number, now: Date) => ({
    recordedAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    lng: 27.4935,
    lat: -11.6645,
    accuracyM: 9,
  });

  it("posts queued pings oldest-first to /api/v1/agent/positions and clears them", async () => {
    const db = new AgentDb(`pings-${++n}`);
    const now = new Date("2026-09-23T10:00:00+02:00");
    await queuePing(db, ping(6, now));
    await queuePing(db, ping(3, now));
    const seen: unknown[] = [];
    const r = await flushPings(
      db,
      fetchWith((url, init) => {
        expect(url).toBe("/api/v1/agent/positions");
        seen.push(JSON.parse(String(init?.body)));
        return json(200, { ok: true, data: { accepted: 2, ignored: 0 } });
      }),
      now,
    );
    expect(r).toEqual({ sent: 2, remaining: 0, unauthenticated: false });
    expect(seen).toHaveLength(1);
    const body = seen[0] as Array<{ recordedAt: string; accuracyM: number }>;
    expect(body.map((p) => p.recordedAt)).toEqual([
      ping(6, now).recordedAt,
      ping(3, now).recordedAt,
    ]);
    expect(body[0]?.accuracyM).toBe(9);
    expect(await db.pings.count()).toBe(0);
    // The outbox is untouched: pings are not records (invariant 3).
    expect(await db.outbox.count()).toBe(0);
  });

  it("keeps the queue on 401 (session ended), 5xx and network failure; drops it on 422", async () => {
    const now = new Date("2026-09-23T10:00:00+02:00");
    for (const [status, expected] of [
      [401, { sent: 0, remaining: 1, unauthenticated: true }],
      [500, { sent: 0, remaining: 1, unauthenticated: false }],
      [429, { sent: 0, remaining: 1, unauthenticated: false }],
      [422, { sent: 0, remaining: 0, unauthenticated: false }],
    ] as const) {
      const db = new AgentDb(`pings-${++n}`);
      await queuePing(db, ping(1, now));
      const r = await flushPings(
        db,
        fetchWith(() => json(status, { ok: false })),
        now,
      );
      expect(r, String(status)).toEqual(expected);
    }
    const db = new AgentDb(`pings-${++n}`);
    await queuePing(db, ping(1, now));
    const r = await flushPings(
      db,
      fetchWith(() => {
        throw new TypeError("offline");
      }),
      now,
    );
    expect(r).toEqual({ sent: 0, remaining: 1, unauthenticated: false });
  });

  it("prunes fixes older than 24 h and caps the queue", async () => {
    const db = new AgentDb(`pings-${++n}`);
    const now = new Date("2026-09-23T10:00:00+02:00");
    await queuePing(db, ping(25 * 60, now));
    await queuePing(db, ping(5, now));
    expect(await prunePings(db, now)).toBe(1);
    expect(await db.pings.count()).toBe(1);
    for (let i = 0; i < PING_MAX_QUEUE + 10; i++) await queuePing(db, ping(0, now));
    expect(await db.pings.count()).toBe(PING_MAX_QUEUE);
  });
});

describe("formatKm", () => {
  it("uses one decimal and a French comma", () => {
    expect(formatKm(1_234)).toBe("1,2 km");
    expect(formatKm(0)).toBe("0,0 km");
    expect(formatKm(12_960)).toBe("13,0 km");
  });
});
