import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { categoriesForRegistration, registerFromBackOffice } from "@/lib/admin/register";
import type { CensusInput } from "@/lib/census/schema";
import { admins, auditLog, entities, notifications, obligations, taxpayers } from "@/lib/db/schema";
import type { AdminSession } from "@/lib/identity/session";
import { runSeed } from "@/scripts/seed";

import { appDb } from "./db";

const CTX = { ip: "198.51.100.11", userAgent: "vitest back office" };
const NOW = new Date("2026-09-13T10:00:00+02:00");

let superviseur: AdminSession;
let finances: AdminSession;
let auditeur: AdminSession;
let maire: AdminSession;

const sessionFor = async (email: string): Promise<AdminSession> => {
  const [row] = await appDb().select().from(admins).where(eq(admins.email, email));
  if (!row) throw new Error(`no admin ${email}`);
  return {
    adminId: row.id,
    authUserId: row.authUserId ?? "00000000-0000-0000-0000-000000000000",
    email: row.email,
    fullName: row.fullName,
    role: row.role,
  };
};

/** A record as the dashboard form sends it: the office passes a hand-placed point. */
function record(phone: string): CensusInput {
  return {
    clientUuid: randomUUID(),
    taxpayer: {
      kind: "person",
      fullName: "Test Guichet Mairie",
      phone,
      communeCode: "KAM",
      quartierCode: "bel-air",
      address: "Av. du Guichet 11",
    },
    entity: {
      kind: "property",
      categoryCode: "menage",
      name: "Résidence Av. du Guichet 11",
      gps: { lng: 27.497, lat: -11.672 },
    },
  };
}

/** Unique per run: the seed is additive and the feature refuses a phone already on file. */
const RUN = String(Date.now()).slice(-6);
const PHONE = (n: number) => `+24399${RUN}${n}`;

describe("registration from the back office", () => {
  beforeAll(async () => {
    await runSeed(appDb());
    [superviseur, finances, auditeur, maire] = await Promise.all([
      sessionFor("ilunga.m@lubumbashi.cd"),
      sessionFor("ngoy.k@lubumbashi.cd"),
      sessionFor("auditeur@lubumbashi.cd"),
      sessionFor("maire@lubumbashi.cd"),
    ]);
  }, 120_000);

  it("the Superviseur registers: ID, entity, obligations, SMS queued, audit with the admin actor, no agent nor device; idempotent on clientUuid", async () => {
    const db = appDb();
    const input = record(PHONE(1));
    const first = await registerFromBackOffice(db, superviseur, input, CTX, NOW);
    expect(first.created).toBe(true);
    expect(first.taxpayerNo).toMatch(/^LUB-KAM-\d{8}$/);
    expect(first.obligations.length).toBeGreaterThanOrEqual(1);
    expect(first.obligations[0]).toMatchObject({ periodStart: "2026-09-01", amountFc: 5000 });

    const [tp] = await db.select().from(taxpayers).where(eq(taxpayers.id, first.taxpayerId));
    expect(tp).toMatchObject({
      taxpayerNo: first.taxpayerNo,
      registeredByAgentId: null,
      registeredDeviceId: null,
      clientUuid: input.clientUuid,
    });
    const [ent] = await db.select().from(entities).where(eq(entities.id, first.entityId));
    expect(ent).toMatchObject({ registeredByAgentId: null, gpsAccuracyM: null });
    expect(ent?.location).toEqual({ x: 27.497, y: -11.672 });
    const obs = await db.select().from(obligations).where(eq(obligations.taxpayerId, tp!.id));
    expect(obs.length).toBe(first.obligations.length);
    expect(obs.every((o) => o.status === "due" && o.invoiceNo?.startsWith("AV-"))).toBe(true);
    const queued = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.taxpayerId, tp!.id), eq(notifications.kind, "registration")));
    expect(queued).toHaveLength(1);
    expect(queued[0]?.to).toBe(PHONE(1));

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "taxpayer.registered"), eq(auditLog.objectId, first.taxpayerNo)),
      );
    expect(audit).toMatchObject({
      actorType: "admin",
      actorId: superviseur.adminId,
      actorRole: "superviseur",
      actorLabel: "ilunga.m@lubumbashi.cd",
      ip: "198.51.100.11",
      userAgent: "vitest back office",
      deviceId: null,
      gps: null,
    });
    expect(audit?.details).toMatchObject({
      gpsSource: "manual",
      registeredFrom: "back_office",
      gpsAccuracyM: null,
      category: "menage",
    });

    // The same record again (double click, retried request) returns the same taxpayer.
    const second = await registerFromBackOffice(db, superviseur, input, CTX, NOW);
    expect(second.created).toBe(false);
    expect(second.taxpayerNo).toBe(first.taxpayerNo);
    const rows = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "taxpayer.registered"), eq(auditLog.objectId, first.taxpayerNo)),
      );
    expect(rows).toHaveLength(1);
  });

  it("a hand-placed point is accepted even in production for the office (D34 placeholder)", async () => {
    const db = appDb();
    const saved = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    try {
      const r = await registerFromBackOffice(db, superviseur, record(PHONE(2)), CTX, NOW);
      expect(r.created).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = saved;
    }
  });

  it("refuses Auditeur, Finances and Maire", async () => {
    const db = appDb();
    for (const session of [auditeur, finances, maire]) {
      await expect(
        registerFromBackOffice(db, session, record(PHONE(3)), CTX, NOW),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    const [none] = await db
      .select()
      .from(taxpayers)
      .where(eq(taxpayers.phone, PHONE(3)));
    expect(none).toBeUndefined();
  });

  it("refuses a phone number already on file, naming the existing taxpayer", async () => {
    const db = appDb();
    await expect(
      registerFromBackOffice(db, superviseur, record("+243994128830"), CTX, NOW),
    ).rejects.toMatchObject({ code: "duplicate_phone", detail: "LUB-KAM-00000125" });
  });

  it("validates the record and knows which categories need a tax base", async () => {
    const db = appDb();
    const bad = record(PHONE(4));
    await expect(
      registerFromBackOffice(
        db,
        superviseur,
        { ...bad, taxpayer: { ...bad.taxpayer, phone: "0990000814" } },
        CTX,
        NOW,
      ),
    ).rejects.toThrow();
    await expect(
      registerFromBackOffice(
        db,
        superviseur,
        { ...bad, taxpayer: { ...bad.taxpayer, quartierCode: "nulle-part" } },
        CTX,
        NOW,
      ),
    ).rejects.toMatchObject({ code: "unknown_quartier" });
    const cats = await categoriesForRegistration(db);
    expect(cats.map((c) => c.code)).toContain("menage");
    // The seed's only percent_of_base rule (taxe immobilière) is still a draft: no base required.
    expect(cats.find((c) => c.code === "menage")?.needsTaxBase).toBe(false);
  });
});
