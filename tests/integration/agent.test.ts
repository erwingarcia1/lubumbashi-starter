import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { findDuplicates } from "@/lib/census/duplicates";
import { registerTaxpayer } from "@/lib/census/register";
import { agents, auditLog, devices, obligations, taxpayers } from "@/lib/db/schema";
import { AgentLoginError, loginAgent } from "@/lib/identity/agent-auth";
import type { AgentSession } from "@/lib/identity/agent-session";
import { runSeed } from "@/scripts/seed";

import { appDb } from "./db";

describe("agent login (matricule + PIN + device)", () => {
  beforeAll(async () => {
    await runSeed(appDb());
    await appDb()
      .update(agents)
      .set({ failedPinAttempts: 0, lockedUntil: null })
      .where(eq(agents.matricule, "AG-KAM-014"));
  }, 120_000);

  it("registers a new device on first login, then recognises it by code + secret", async () => {
    const db = appDb();
    const first = await loginAgent(
      db,
      { matricule: "AG-KAM-007", pin: "123456", device: { label: "Test phone" } },
      { userAgent: "vitest" },
    );
    expect(first.device.code).toMatch(/^DEV-[0-9A-F]{4}$/);
    expect(first.device.secret).toBeDefined();
    expect(first.zoneName).toBe("Bel-Air");
    const again = await loginAgent(db, {
      matricule: "AG-KAM-007",
      pin: "123456",
      device: { code: first.device.code, secret: first.device.secret },
    });
    expect(again.device.id).toBe(first.device.id);
    expect(again.device.secret).toBeUndefined();
    const wrongSecret = await loginAgent(db, {
      matricule: "AG-KAM-007",
      pin: "123456",
      device: { code: first.device.code, secret: "nope" },
    });
    expect(wrongSecret.device.id).not.toBe(first.device.id); // a new device, never a hijack
    const [row] = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "device.registered"), eq(auditLog.objectId, first.device.code)),
      );
    expect(row?.actorLabel).toBe("AG-KAM-007");
  });

  it("refuses a revoked device and a wrong PIN, and locks after five failures", async () => {
    const db = appDb();
    await expect(
      loginAgent(db, { matricule: "AG-KAM-011", pin: "123456", device: { code: "DEV-9C21" } }),
    ).rejects.toMatchObject({ code: "device_revoked" });
    for (let i = 1; i <= 4; i++) {
      await expect(
        loginAgent(db, { matricule: "AG-KAM-014", pin: "000000", device: {} }),
      ).rejects.toMatchObject({ code: "invalid_credentials" });
    }
    await expect(
      loginAgent(db, { matricule: "AG-KAM-014", pin: "000000", device: {} }),
    ).rejects.toMatchObject({ code: "locked" });
    await expect(
      loginAgent(db, { matricule: "AG-KAM-014", pin: "123456", device: {} }),
    ).rejects.toBeInstanceOf(AgentLoginError);
    await db
      .update(agents)
      .set({ failedPinAttempts: 0, lockedUntil: null })
      .where(eq(agents.matricule, "AG-KAM-014"));
    await expect(
      loginAgent(db, { matricule: "AG-KAM-999", pin: "123456", device: {} }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
  });
});

describe("census registration", () => {
  let session: AgentSession;
  beforeAll(async () => {
    const db = appDb();
    const [agent] = await db.select().from(agents).where(eq(agents.matricule, "AG-KAM-007"));
    const [device] = await db.select().from(devices).where(eq(devices.deviceCode, "DEV-3F9A"));
    session = {
      agentId: agent!.id,
      matricule: agent!.matricule,
      fullName: agent!.fullName,
      zoneId: agent!.zoneId,
      communeId: agent!.communeId,
      deviceId: device!.id,
      deviceCode: device!.deviceCode,
    };
  });

  it("finds duplicates by phone and by similar name within 30 m", async () => {
    const db = appDb();
    const byPhone = await findDuplicates(db, { phone: "+243994128830" });
    expect(byPhone.map((d) => [d.taxpayerNo, d.reason])).toEqual([
      ["LUB-KAM-00000125", "same_phone"],
    ]);
    const nearby = await findDuplicates(db, {
      fullName: "Mwamba Kasongo J.",
      gps: { lng: 27.4931, lat: -11.6642 },
    });
    expect(nearby[0]).toMatchObject({
      taxpayerNo: "LUB-KAM-00000125",
      reason: "similar_name_nearby",
    });
    expect(nearby[0]!.distanceM).toBeLessThan(30);
    expect(
      await findDuplicates(db, { fullName: "Mwamba Kasongo J.", gps: { lng: 27.5, lat: -11.6 } }),
    ).toEqual([]);
  });

  it("allocates the next ID, issues obligations from the registration period, queues the SMS, audits, and is idempotent", async () => {
    const db = appDb();
    const clientUuid = randomUUID();
    const input = {
      clientUuid,
      taxpayer: {
        kind: "person" as const,
        fullName: "Test Recensement Intégration",
        phone: "+243990000777",
        communeCode: "KAM",
        quartierCode: "bel-air",
        address: "Av. Test 7",
      },
      entity: {
        kind: "property" as const,
        categoryCode: "menage",
        name: "Résidence Av. Test 7",
        gps: { lng: 27.495, lat: -11.67, accuracyM: 8 },
      },
      capturedAt: "2026-08-15T09:00:00+02:00",
    };
    const first = await registerTaxpayer(db, session, input, new Date("2026-09-13T10:00:00+02:00"));
    expect(first.created).toBe(true);
    expect(first.taxpayerNo).toMatch(/^LUB-KAM-\d{8}$/);
    expect(first.obligations.map((o) => o.periodStart)).toEqual(["2026-08-01", "2026-09-01"]);
    const second = await registerTaxpayer(db, session, input);
    expect(second.created).toBe(false);
    expect(second.taxpayerNo).toBe(first.taxpayerNo);
    const [tp] = await db.select().from(taxpayers).where(eq(taxpayers.clientUuid, clientUuid));
    expect(tp?.registeredDeviceId).toBe(session.deviceId);
    const obs = await db.select().from(obligations).where(eq(obligations.taxpayerId, tp!.id));
    expect(obs).toHaveLength(2);
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "taxpayer.registered"), eq(auditLog.objectId, first.taxpayerNo)),
      );
    expect(audit?.deviceId).toBe(session.deviceId);
    expect(audit?.gps).toEqual({ x: 27.495, y: -11.67 });
    await expect(
      registerTaxpayer(db, session, {
        ...input,
        clientUuid: randomUUID(),
        taxpayer: { ...input.taxpayer, communeCode: "ZZZ" },
      }),
    ).rejects.toMatchObject({ code: "unknown_commune" });
  });
});
