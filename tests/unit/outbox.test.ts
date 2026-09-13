import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { AgentDb } from "@/lib/offline/db";
import { assertOutboxKind, enqueue, pruneDone, requeue, syncOutbox } from "@/lib/offline/outbox";

let db: AgentDb;
let n = 0;

const census = (name: string) => ({
  clientUuid: crypto.randomUUID(),
  taxpayer: {
    kind: "person",
    fullName: name,
    phone: "+243990000001",
    communeCode: "KAM",
    quartierCode: "bel-air",
    address: "Av. Kasaï 1",
  },
  entity: {
    kind: "property",
    categoryCode: "menage",
    name: "Av. Kasaï 1",
    gps: { lng: 27.49, lat: -11.66 },
  },
});

function fetchWith(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response> | never,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("offline outbox (invariant 3: census and contact updates only)", () => {
  beforeEach(async () => {
    db = new AgentDb(`test-${++n}`);
    await db.open();
  });

  it("refuses any kind that is not census or contact_update", async () => {
    expect(() => assertOutboxKind("payment")).toThrow(/invariant 3/);
    await expect(
      enqueue(db, {
        kind: "payment" as never,
        clientUuid: crypto.randomUUID(),
        payload: {},
        label: "x",
      }),
    ).rejects.toThrow(/invariant 3/);
    expect(await db.outbox.count()).toBe(0);
  });

  it("network failure keeps everything queued and stops the run; success marks done with the server id", async () => {
    await enqueue(db, { kind: "census", clientUuid: "a", payload: census("A"), label: "A" });
    await enqueue(db, { kind: "census", clientUuid: "b", payload: census("B"), label: "B" });
    const offline = await syncOutbox(
      db,
      fetchWith(() => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(offline).toMatchObject({ sent: 0, failed: 0, remaining: 2 });
    expect((await db.outbox.toArray()).map((i) => i.status)).toEqual(["queued", "queued"]);
    expect((await db.outbox.get(1))?.attempts).toBe(1);

    const seen: string[] = [];
    const online = await syncOutbox(
      db,
      fetchWith((url, init) => {
        seen.push(`${init?.method} ${url}`);
        const body = JSON.parse(String(init?.body)) as { taxpayer: { fullName: string } };
        return json(201, {
          ok: true,
          data: {
            taxpayerNo: `LUB-KAM-0000${body.taxpayer.fullName === "A" ? "0001" : "0002"}`,
            entityId: "e1",
            created: true,
          },
        });
      }),
    );
    expect(online).toMatchObject({ sent: 2, failed: 0, remaining: 0, unauthenticated: false });
    expect(seen).toEqual(["POST /api/v1/census", "POST /api/v1/census"]);
    const items = (await db.outbox.toArray()).sort((a, b) => a.id! - b.id!);
    expect(items.map((i) => i.serverRef)).toEqual(["LUB-KAM-00000001", "LUB-KAM-00000002"]);
    expect(items.every((i) => i.status === "done")).toBe(true);
    // Re-running sends nothing: done items are never replayed.
    expect(
      (
        await syncOutbox(
          db,
          fetchWith(() => {
            throw new Error("must not be called");
          }),
        )
      ).sent,
    ).toBe(0);
  });

  it("a 401 pauses the queue for a new login; a 4xx is final and can be requeued; a 5xx is retried", async () => {
    await enqueue(db, { kind: "census", clientUuid: "c", payload: census("C"), label: "C" });
    expect(
      (
        await syncOutbox(
          db,
          fetchWith(() => json(401, { ok: false, error: { code: "unauthenticated" } })),
        )
      ).unauthenticated,
    ).toBe(true);
    expect((await db.outbox.get(1))?.status).toBe("queued");

    expect(
      (
        await syncOutbox(
          db,
          fetchWith(() => json(503, { ok: false, error: { code: "db_down" } })),
        )
      ).remaining,
    ).toBe(1);
    expect((await db.outbox.get(1))?.lastError).toBe("db_down");
    expect((await db.outbox.get(1))?.status).toBe("queued");

    const refused = await syncOutbox(
      db,
      fetchWith(() => json(422, { ok: false, error: { code: "unknown_quartier" } })),
    );
    expect(refused.failed).toBe(1);
    expect(await db.outbox.get(1)).toMatchObject({
      status: "failed",
      lastError: "unknown_quartier",
    });
    await requeue(db, 1);
    expect((await db.outbox.get(1))?.status).toBe("queued");
  });

  it("contact updates PATCH the taxpayer; photos upload after the record and never block it", async () => {
    await enqueue(db, {
      kind: "contact_update",
      clientUuid: "d",
      payload: { taxpayerNo: "LUB-KAM-00000125", phone: "+243990000002" },
      label: "125",
    });
    await enqueue(db, {
      kind: "census",
      clientUuid: "e",
      payload: census("E"),
      label: "E",
      photos: [{ kind: "facade", blob: new Blob([new Uint8Array(10)], { type: "image/jpeg" }) }],
    });
    const calls: string[] = [];
    const r = await syncOutbox(
      db,
      fetchWith((url, init) => {
        calls.push(`${init?.method} ${url}`);
        if (url.startsWith("/api/v1/taxpayers/"))
          return json(200, { ok: true, data: { taxpayerNo: "LUB-KAM-00000125" } });
        if (url === "/api/v1/census")
          return json(201, { ok: true, data: { taxpayerNo: "LUB-KAM-00000130", entityId: "e9" } });
        if (url.endsWith("/upload-url"))
          return json(200, { ok: false, error: { code: "storage_down" } });
        return json(500, {});
      }),
    );
    expect(r.sent).toBe(2);
    expect(calls[0]).toBe("PATCH /api/v1/taxpayers/LUB-KAM-00000125");
    const censusItem = (await db.outbox.toArray()).find((i) => i.clientUuid === "e")!;
    expect(censusItem.status).toBe("done");
    expect(censusItem.photos).toHaveLength(1); // still pending, record synced anyway
    expect(await pruneDone(db, 0, new Date(Date.now() + 1000))).toBe(1); // only the photo-less item leaves
    expect(await db.outbox.count()).toBe(1);
  });
});
