import type { AgentDb, Ping } from "@/lib/offline/db";

/**
 * The phone's queue of position pings, separate from the offline outbox by design: the outbox
 * holds census records and contact updates only (invariant 3), and a ping is neither.
 */
export const PING_INTERVAL_MS = 3 * 60_000;
export const PING_BATCH = 50;
/** The server ignores older fixes anyway (lib/tracking/ingest.ts). */
export const PING_MAX_AGE_MS = 24 * 3_600_000;
/** A phone that stays offline for days must not fill its storage with pings. */
export const PING_MAX_QUEUE = 500;
export const PING_REQUEST_TIMEOUT_MS = 15_000;

export async function queuePing(db: AgentDb, ping: Omit<Ping, "id">): Promise<number> {
  const id = await db.pings.add({ ...ping });
  const count = await db.pings.count();
  if (count > PING_MAX_QUEUE) {
    const oldest = await db.pings
      .orderBy("recordedAt")
      .limit(count - PING_MAX_QUEUE)
      .primaryKeys();
    await db.pings.bulkDelete(oldest);
  }
  return id as number;
}

export async function prunePings(db: AgentDb, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PING_MAX_AGE_MS).toISOString();
  const old = await db.pings.where("recordedAt").below(cutoff).primaryKeys();
  await db.pings.bulkDelete(old);
  return old.length;
}

export interface FlushResult {
  sent: number;
  remaining: number;
  /** The agent session ended: keep the queue, stop until the next login. */
  unauthenticated: boolean;
}

/**
 * Sends queued pings oldest-first, 50 per request. A refused batch (4xx other than 401/429) is
 * dropped: it is malformed and would never pass. A network failure, a 5xx or a 429 keeps it.
 */
export async function flushPings(
  db: AgentDb,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<FlushResult> {
  await prunePings(db, now);
  const result: FlushResult = { sent: 0, remaining: 0, unauthenticated: false };
  for (;;) {
    const batch = await db.pings.orderBy("recordedAt").limit(PING_BATCH).toArray();
    if (batch.length === 0) break;
    let res: Response;
    try {
      res = await fetchImpl("/api/v1/agent/positions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          batch.map((p) => ({
            recordedAt: p.recordedAt,
            lng: p.lng,
            lat: p.lat,
            accuracyM: p.accuracyM ?? undefined,
          })),
        ),
        signal: AbortSignal.timeout(PING_REQUEST_TIMEOUT_MS),
      });
    } catch {
      break;
    }
    if (res.status === 401) {
      result.unauthenticated = true;
      break;
    }
    if (res.status === 429 || res.status >= 500) break;
    await db.pings.bulkDelete(batch.map((p) => p.id!));
    if (res.ok) result.sent += batch.length;
    if (batch.length < PING_BATCH) break;
  }
  result.remaining = await db.pings.count();
  return result;
}
