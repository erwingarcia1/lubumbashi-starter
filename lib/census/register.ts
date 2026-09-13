import { and, eq } from "drizzle-orm";

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
import { computeObligations, type Rule } from "@/lib/tax-engine";

import { censusInput, type CensusInput } from "./schema";

export class CensusError extends Error {
  constructor(readonly code: "unknown_commune" | "unknown_quartier" | "unknown_category") {
    super(code);
    this.name = "CensusError";
  }
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
 * row with the agent, GPS and device. Idempotent on `clientUuid` (M8 offline sync).
 */
export async function registerTaxpayer(
  db: Db,
  session: AgentSession,
  raw: CensusInput,
  now = new Date(),
): Promise<RegistrationResult> {
  const input = censusInput.parse(raw);
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
        registeredByAgentId: session.agentId,
        registeredDeviceId: session.deviceId,
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
        gpsAccuracyM: input.entity.gps.accuracyM ?? null,
        taxBaseFc: input.entity.taxBaseFc ?? null,
        registeredAt,
        registeredByAgentId: session.agentId,
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
    await tx.insert(notifications).values({
      taxpayerId: tp!.id,
      kind: "registration",
      channel: "sms",
      to: input.taxpayer.phone,
      templateKey: "registration",
      payload: { taxpayerNo, fullName: input.taxpayer.fullName },
    });
    await writeAudit(tx, {
      actor: { type: "agent", id: session.agentId, role: "agent", label: session.matricule },
      action: "taxpayer.registered",
      object: { type: "taxpayer", id: taxpayerNo },
      details: {
        entity: input.entity.name,
        category: category.code,
        clientUuid: input.clientUuid,
        gpsAccuracyM: input.entity.gps.accuracyM ?? null,
        obligations: issued.length,
      },
      where: { gps: { lng: input.entity.gps.lng, lat: input.entity.gps.lat } },
      device: { id: session.deviceId },
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
