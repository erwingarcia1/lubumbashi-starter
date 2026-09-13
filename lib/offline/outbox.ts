import { OUTBOX_KINDS, type AgentDb, type OutboxItem, type OutboxKind, type PhotoKind } from "./db";

export const LAST_SYNC_KEY = "outbox:lastSyncAt";
/** A hung request must not block the queue: it is treated like a network failure and retried. */
export const REQUEST_TIMEOUT_MS = 20_000;

export function assertOutboxKind(kind: string): asserts kind is OutboxKind {
  if (!(OUTBOX_KINDS as readonly string[]).includes(kind))
    throw new Error(
      `offline outbox accepts census and contact updates only, not "${kind}" (invariant 3)`,
    );
}

export async function enqueue(
  db: AgentDb,
  item: {
    kind: OutboxKind;
    clientUuid: string;
    payload: unknown;
    label: string;
    photos?: Array<{ kind: PhotoKind; blob: Blob }>;
  },
  now = new Date(),
): Promise<number> {
  assertOutboxKind(item.kind);
  const id = await db.outbox.add({
    kind: item.kind,
    clientUuid: item.clientUuid,
    payload: item.payload,
    label: item.label,
    createdAt: now.toISOString(),
    attempts: 0,
    lastError: null,
    status: "queued",
    serverRef: null,
    photos: item.photos ?? [],
    entityId: null,
  });
  return id as number;
}

export interface SyncResult {
  sent: number;
  failed: number;
  remaining: number;
  /** The agent session ended: stop and let the user log in again; the queue is kept. */
  unauthenticated: boolean;
}

type ApiJson = { ok: boolean; data?: Record<string, unknown>; error?: { code?: string } };

function endpointFor(item: OutboxItem): { path: string; method: "POST" | "PATCH" } {
  if (item.kind === "census") return { path: "/api/v1/census", method: "POST" };
  const p = item.payload as { taxpayerNo: string };
  return { path: `/api/v1/taxpayers/${p.taxpayerNo}`, method: "PATCH" };
}

/**
 * Sends queued items oldest-first. Network failure stops the run (the next reconnect retries);
 * a 5xx is retried later; a 4xx other than 401 is final and shown to the agent. Photos of a
 * synced census record are uploaded afterwards and never block it.
 */
export async function syncOutbox(
  db: AgentDb,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<SyncResult> {
  const result: SyncResult = { sent: 0, failed: 0, remaining: 0, unauthenticated: false };
  const queued = await db.outbox.where("status").equals("queued").sortBy("createdAt");
  for (const item of queued) {
    const { path, method } = endpointFor(item);
    let res: Response;
    try {
      res = await fetchImpl(path, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(item.payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      await db.outbox.update(item.id!, { attempts: item.attempts + 1, lastError: "network" });
      result.remaining += queued.length - result.sent - result.failed;
      return result;
    }
    if (res.status === 401) {
      result.unauthenticated = true;
      result.remaining += queued.length - result.sent - result.failed;
      return result;
    }
    let json: ApiJson | null = null;
    try {
      json = (await res.json()) as ApiJson;
    } catch {
      json = null;
    }
    if (res.ok && json?.ok) {
      const data = json.data ?? {};
      await db.outbox.update(item.id!, {
        status: "done",
        attempts: item.attempts + 1,
        lastError: null,
        serverRef: typeof data.taxpayerNo === "string" ? data.taxpayerNo : null,
        entityId: typeof data.entityId === "string" ? data.entityId : null,
      });
      result.sent += 1;
    } else if (res.status >= 500) {
      await db.outbox.update(item.id!, {
        attempts: item.attempts + 1,
        lastError: json?.error?.code ?? `http_${res.status}`,
      });
      result.remaining += 1;
    } else {
      await db.outbox.update(item.id!, {
        status: "failed",
        attempts: item.attempts + 1,
        lastError: json?.error?.code ?? `http_${res.status}`,
      });
      result.failed += 1;
    }
  }
  await uploadPendingPhotos(db, fetchImpl);
  await db.cache.put({ key: LAST_SYNC_KEY, value: now.toISOString(), syncedAt: now.toISOString() });
  return result;
}

/** Best effort: one signed URL per photo; whatever fails stays for the next run. */
export async function uploadPendingPhotos(
  db: AgentDb,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const done = await db.outbox.where("status").equals("done").toArray();
  let uploaded = 0;
  for (const item of done) {
    if (!item.entityId || item.photos.length === 0) continue;
    const remaining: OutboxItem["photos"] = [];
    for (const photo of item.photos) {
      try {
        const url = await fetchImpl("/api/v1/census/photos/upload-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entityId: item.entityId, kind: photo.kind }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const u = (await url.json()) as ApiJson;
        const signed = u.data as { storagePath: string; signedUrl: string } | undefined;
        if (!u.ok || !signed) throw new Error("no upload url");
        const put = await fetchImpl(signed.signedUrl, {
          method: "PUT",
          headers: { "content-type": "image/jpeg" },
          body: photo.blob,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 3),
        });
        if (!put.ok) throw new Error("put failed");
        const reg = await fetchImpl("/api/v1/census/photos", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entityId: item.entityId,
            kind: photo.kind,
            storagePath: signed.storagePath,
            bytes: photo.blob.size,
          }),
        });
        if (!reg.ok) throw new Error("register failed");
        uploaded += 1;
      } catch {
        remaining.push(photo);
      }
    }
    await db.outbox.update(item.id!, { photos: remaining });
  }
  return uploaded;
}

/** Puts a refused record back in the queue after the agent corrected nothing but wants a retry. */
export async function requeue(db: AgentDb, id: number): Promise<void> {
  await db.outbox.update(id, { status: "queued", lastError: null });
}

export async function discard(db: AgentDb, id: number): Promise<void> {
  await db.outbox.delete(id);
}

/** Housekeeping: synced records older than `days` (and without pending photos) leave the phone. */
export async function pruneDone(db: AgentDb, days = 7, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  const old = await db.outbox
    .where("status")
    .equals("done")
    .filter((i) => i.createdAt < cutoff && i.photos.length === 0)
    .toArray();
  await db.outbox.bulkDelete(old.map((i) => i.id!));
  return old.length;
}
