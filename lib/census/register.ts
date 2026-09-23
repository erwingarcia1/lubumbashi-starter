import { and, eq } from "drizzle-orm";

import { actorOf, deviceOf, whereOf } from "@/lib/admin/context";
import { writeAudit } from "@/lib/audit/write";
import type { Db } from "@/lib/db/client";
import {
  categories,
  entities,
  entityRuleOverrides,
  exemptions,
  notifications,
  obligations,
  taxRuleVersions,
  taxRules,
  taxpayers,
  zones,
} from "@/lib/db/schema";
import type { AgentSession } from "@/lib/identity/agent-session";
import { allocateTaxpayerId } from "@/lib/identity/ids";
import type { AdminSession } from "@/lib/identity/session";
import { issuePortalLink } from "@/lib/portal/links";
import { computeObligations, type Rule } from "@/lib/tax-engine";

import { manualPositionAllowed } from "./position";
import { censusInput, type CensusInput } from "./schema";

export class CensusError extends Error {
  constructor(
    readonly code:
      "unknown_commune" | "unknown_quartier" | "unknown_category" | "manual_position_refused",
  ) {
    super(code);
    this.name = "CensusError";
  }
}

/** A Mairie user registering from the dashboard (`/admin/contribuables/nouveau`). */
export interface AdminRegistrationActor {
  type: "admin";
  session: AdminSession;
}

/**
 * Who registers: a field agent (its device and GPS are the audit WHERE/DEVICE) or a Mairie user
 * at the back office (WHERE = request IP, DEVICE = user agent, position always hand-placed).
 */
export type RegistrationActor = AgentSession | AdminRegistrationActor;

export function isAdminActor(actor: RegistrationActor): actor is AdminRegistrationActor {
  return "type" in actor && actor.type === "admin";
}

export interface RegistrationContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface RegistrationResult {
  taxpayerNo: string;
  taxpayerId: string;
  entityId: string;
  created: boolean;
  obligations: Array<{ ruleCode: string; periodStart: string; dueDate: string; amountFc: number }>;
}

export async function loadRules(db: Db): Promise<Rule[]> {
  const ruleRows = await db.select().from(taxRules);
  const versionRows = await db.select().from(taxRuleVersions);
  return ruleRows.map((r) => ({
    id: r.id,
    code: r.code,
    taxCode: r.taxCode,
    categoryId: r.categoryId,
    active: r.active,
    versions: versionRows.filter((v) => v.taxRuleId === r.id),
  }));
}

/**
 * Registers a taxpayer and its first entity: municipal ID from the commune counter, obligations
 * from the tax engine for the registration period onward, a registration SMS queued, one audit
 * row with the actor, GPS and device. Idempotent on `clientUuid` (M8 offline sync).
 *
 * An agent's record carries the device position (or, outside production, a hand-placed point,
 * D34). A back-office record is always hand-placed: the office has no device GPS, so the audit
 * row says `gpsSource: "manual"`, `registeredFrom: "back_office"`, WHERE = IP, DEVICE = user
 * agent, and `registered_by_agent_id` / `registered_device_id` stay null.
 */
export async function registerTaxpayer(
  db: Db,
  actor: RegistrationActor,
  raw: CensusInput,
  now = new Date(),
  ctx: RegistrationContext = {},
  env: Record<string, string | undefined> = process.env,
): Promise<RegistrationResult> {
  const input = censusInput.parse(raw);
  const admin = isAdminActor(actor);
  const agent = isAdminActor(actor) ? null : actor;
  const auditActor = isAdminActor(actor)
    ? actorOf(actor.session)
    : { type: "agent" as const, id: actor.agentId, role: "agent" as const, label: actor.matricule };
  const manual = admin || input.entity.gps.source === "manual";
  // DECISION-PENDING: D34 — an agent's hand-placed position is refused in production; a
  // back-office registration is hand-placed by nature and accepted everywhere, audited as such.
  if (manual && !admin && !manualPositionAllowed(env))
    throw new CensusError("manual_position_refused");
  const accuracyM = manual ? null : (input.entity.gps.accuracyM ?? null);
  const [existing] = await db
    .select({ id: taxpayers.id, taxpayerNo: taxpayers.taxpayerNo })
    .from(taxpayers)
    .where(eq(taxpayers.clientUuid, input.clientUuid));
  if (existing) {
    const [ent] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(eq(entities.taxpayerId, existing.id));
    const obs = await db
      .select({
        ruleCode: taxRules.code,
        periodStart: obligations.periodStart,
        dueDate: obligations.dueDate,
        amountFc: obligations.amountFc,
      })
      .from(obligations)
      .innerJoin(taxRules, eq(taxRules.id, obligations.taxRuleId))
      .where(eq(obligations.taxpayerId, existing.id));
    return {
      taxpayerNo: existing.taxpayerNo,
      taxpayerId: existing.id,
      entityId: ent?.id ?? "",
      created: false,
      obligations: obs,
    };
  }
  return db.transaction(async (tx) => {
    const [commune] = await tx
      .select()
      .from(zones)
      .where(and(eq(zones.level, "commune"), eq(zones.code, input.taxpayer.communeCode)));
    if (!commune) throw new CensusError("unknown_commune");
    const [quartier] = await tx
      .select()
      .from(zones)
      .where(
        and(
          eq(zones.level, "quartier"),
          eq(zones.parentId, commune.id),
          eq(zones.code, input.taxpayer.quartierCode),
        ),
      );
    if (!quartier) throw new CensusError("unknown_quartier");
    const [category] = await tx
      .select()
      .from(categories)
      .where(eq(categories.code, input.entity.categoryCode));
    if (!category) throw new CensusError("unknown_category");

    const registeredAt = input.capturedAt ? new Date(input.capturedAt) : now;
    const taxpayerNo = await allocateTaxpayerId(tx, commune.code);
    const [tp] = await tx
      .insert(taxpayers)
      .values({
        taxpayerNo,
        kind: input.taxpayer.kind,
        fullName: input.taxpayer.fullName,
        contactName: input.taxpayer.contactName ?? null,
        phone: input.taxpayer.phone,
        idType: input.taxpayer.idType ?? null,
        idNumber: input.taxpayer.idNumber ?? null,
        communeId: commune.id,
        quartierId: quartier.id,
        address: input.taxpayer.address,
        registeredAt,
        registeredByAgentId: agent?.agentId ?? null,
        registeredDeviceId: agent?.deviceId ?? null,
        clientUuid: input.clientUuid,
      })
      .returning({ id: taxpayers.id });
    const [ent] = await tx
      .insert(entities)
      .values({
        taxpayerId: tp!.id,
        kind: input.entity.kind,
        categoryId: category.id,
        name: input.entity.name,
        address: input.taxpayer.address,
        communeId: commune.id,
        quartierId: quartier.id,
        location: { x: input.entity.gps.lng, y: input.entity.gps.lat },
        gpsAccuracyM: accuracyM,
        taxBaseFc: input.entity.taxBaseFc ?? null,
        registeredAt,
        registeredByAgentId: agent?.agentId ?? null,
        clientUuid: input.clientUuid,
      })
      .returning({ id: entities.id });

    const rules = await loadRules(tx as unknown as Db);
    const overrides = await tx
      .select()
      .from(entityRuleOverrides)
      .where(eq(entityRuleOverrides.entityId, ent!.id));
    const exemptionRows = await tx
      .select()
      .from(exemptions)
      .where(eq(exemptions.taxpayerId, tp!.id));
    const { obligations: drafts } = computeObligations({
      entity: {
        id: ent!.id,
        categoryId: category.id,
        taxBaseFc: input.entity.taxBaseFc ?? null,
        registeredAt,
        active: true,
      },
      rules,
      overrides,
      exemptions: exemptionRows.map((x) => ({
        taxRuleId: x.taxRuleId,
        validFrom: x.validFrom,
        validTo: x.validTo,
      })),
      asOf: now,
    });
    const issued: RegistrationResult["obligations"] = [];
    for (const d of drafts) {
      await tx
        .insert(obligations)
        .values({
          entityId: d.entityId,
          taxpayerId: tp!.id,
          taxRuleId: d.taxRuleId,
          taxRuleVersionId: d.taxRuleVersionId,
          periodStart: d.periodStart,
          periodEnd: d.periodEnd,
          dueDate: d.dueDate,
          amountFc: d.amountFc,
        })
        .onConflictDoNothing();
      issued.push({
        ruleCode: rules.find((r) => r.id === d.taxRuleId)?.code ?? d.taxRuleId,
        periodStart: d.periodStart,
        dueDate: d.dueDate,
        amountFc: d.amountFc,
      });
    }
    // The welcome SMS carries the household's signed portal link (link-based access, no password).
    const link = await issuePortalLink(tx, tp!.id, now);
    await tx.insert(notifications).values({
      taxpayerId: tp!.id,
      kind: "registration",
      channel: "sms",
      to: input.taxpayer.phone,
      templateKey: "registration",
      payload: { taxpayerNo, fullName: input.taxpayer.fullName, portalUrl: link.url },
    });
    await writeAudit(tx, {
      actor: auditActor,
      action: "taxpayer.registered",
      object: { type: "taxpayer", id: taxpayerNo },
      details: {
        entity: input.entity.name,
        category: category.code,
        clientUuid: input.clientUuid,
        gpsAccuracyM: accuracyM,
        gpsSource: manual ? "manual" : "device",
        registeredFrom: agent ? "field" : "back_office",
        obligations: issued.length,
      },
      // Invariant 4: WHERE is the device GPS; a hand-placed point is not one, so the IP stands in.
      where: manual
        ? whereOf(ctx)
        : { gps: { lng: input.entity.gps.lng, lat: input.entity.gps.lat } },
      device: agent ? { id: agent.deviceId } : deviceOf(ctx),
    });
    return {
      taxpayerNo,
      taxpayerId: tp!.id,
      entityId: ent!.id,
      created: true,
      obligations: issued,
    };
  });
}

/** What registering an entity of this category would cost now (screen a-reg2). */
export async function previewObligations(db: Db, categoryCode: string, now = new Date()) {
  const [category] = await db.select().from(categories).where(eq(categories.code, categoryCode));
  if (!category) throw new CensusError("unknown_category");
  const rules = await loadRules(db);
  const { obligations: drafts } = computeObligations({
    entity: {
      id: "preview",
      categoryId: category.id,
      taxBaseFc: null,
      registeredAt: now,
      active: true,
    },
    rules,
    asOf: now,
  });
  return drafts.map((d) => ({
    ruleCode: rules.find((r) => r.id === d.taxRuleId)?.code ?? "",
    labelFr: "",
    periodStart: d.periodStart,
    dueDate: d.dueDate,
    amountFc: d.amountFc,
  }));
}
