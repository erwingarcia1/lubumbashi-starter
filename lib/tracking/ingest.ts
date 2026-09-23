import { z } from "zod";

import type { Db } from "@/lib/db/client";
import { agentPositions } from "@/lib/db/schema";
import { businessClock } from "@/lib/time";

/** Positions are kept only inside these business hours (Africa/Lubumbashi, `from` inclusive, `to` exclusive). */
// DECISION-PENDING: D38 — tracking hours.
export const TRACKING_HOURS = { from: 6, to: 20 } as const;
/** A phone that was offline replays its queue; anything older than this is not worth keeping. */
export const MAX_POSITION_AGE_MS = 24 * 3_600_000;
/** Device clocks drift: a fix "from the future" by more than this is dropped. */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
export const MAX_POSITIONS_PER_REQUEST = 50;

/**
 * What a stored position is. Only `ping` ever comes from the phone (see `ingestPositions`); the
 * other values are reserved for server-side writers (the seed's demo trail), so an agent cannot
 * forge census or collection acts in their own trail.
 */
export const POSITION_SOURCES = ["ping", "census", "payment"] as const;
export type PositionSource = (typeof POSITION_SOURCES)[number];

/** The phone's contract: strict, so a body carrying `source` (or any other extra field) is refused. */
export const positionInput = z.strictObject({
  /** Device clock at the fix (ISO 8601 with zone). */
  recordedAt: z.iso.datetime({ offset: true }),
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  accuracyM: z.number().min(0).max(100_000).optional(),
});
export const positionsInput = z.array(positionInput).max(MAX_POSITIONS_PER_REQUEST);
export type PositionInput = z.infer<typeof positionInput>;

export function isWithinTrackingHours(at: Date): boolean {
  const { hour } = businessClock(at);
  return hour >= TRACKING_HOURS.from && hour < TRACKING_HOURS.to;
}

/** Whether a fix taken at `recordedAt` is stored when it reaches the server at `now`. */
export function acceptsPosition(recordedAt: Date, now: Date): boolean {
  const age = now.getTime() - recordedAt.getTime();
  if (Number.isNaN(age) || age > MAX_POSITION_AGE_MS || age < -MAX_CLOCK_SKEW_MS) return false;
  return isWithinTrackingHours(recordedAt);
}

/**
 * Stores the acceptable positions of a logged-in agent's device; the rest are ignored, not
 * refused, so the phone can drop its queue either way. `received_at` is the server clock and the
 * source is always `ping`: acts (census, collection) come from the audit log, never from the phone.
 */
export async function ingestPositions(
  db: Db,
  agent: { agentId: string; deviceId: string },
  list: PositionInput[],
  now = new Date(),
): Promise<{ accepted: number; ignored: number }> {
  const kept = list.filter((p) => acceptsPosition(new Date(p.recordedAt), now));
  if (kept.length > 0) {
    await db.insert(agentPositions).values(
      kept.map((p) => ({
        agentId: agent.agentId,
        deviceId: agent.deviceId,
        recordedAt: new Date(p.recordedAt),
        receivedAt: now,
        location: { x: p.lng, y: p.lat },
        accuracyM: p.accuracyM === undefined ? null : Math.round(p.accuracyM),
        source: "ping" as const satisfies PositionSource,
      })),
    );
  }
  return { accepted: kept.length, ignored: list.length - kept.length };
}
