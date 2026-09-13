import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "@/lib/audit/write";
import type { Db } from "@/lib/db/client";
import {
  auditLog,
  categories,
  entities,
  obligations,
  payments,
  providerConfirmations,
  receipts,
  taxRules,
  taxpayers,
  zones,
} from "@/lib/db/schema";
import { canEditTaxpayer } from "@/lib/identity/roles";
import type { AdminSession } from "@/lib/identity/session";
import { summarizeBalance, type Balance } from "@/lib/registry/balance";
import { computePenalty } from "@/lib/tax-engine";
import { businessDate } from "@/lib/time";

import { actorOf, deviceOf, whereOf, type RequestContext } from "./context";
import { AdminError } from "./errors";

export interface TaxpayerListItem {
  taxpayerNo: string;
  fullName: string;
  categoryLabel: string | null;
  quartier: string | null;
  phone: string;
  balance: Balance;
}

export interface ListFilters {
  q?: string;
  communeCode?: string;
  pill?: "paid" | "due" | "late";
  page?: number;
  pageSize?: number;
}

export async function listTaxpayers(db: Db, filters: ListFilters = {}, asOf = new Date()) {
  const day = businessDate(asOf);
  const pageSize = Math.min(filters.pageSize ?? 50, 200);
  const page = Math.max(filters.page ?? 1, 1);
  const q = filters.q?.trim();
  const commune = filters.communeCode?.trim();
  const conditions = [eq(taxpayers.status, "active")];
  if (q) {
    const like = `%${q}%`;
    conditions.push(
      or(
        ilike(taxpayers.fullName, like),
        ilike(taxpayers.phone, like),
        ilike(taxpayers.taxpayerNo, like),
      )!,
    );
  }
  if (commune) conditions.push(eq(zones.code, commune));
  const rows = await db
    .select({
      tp: taxpayers,
      quartier: sql<
        string | null
      >`(select z.name from app.zones z where z.id = ${taxpayers.quartierId})`,
    })
    .from(taxpayers)
    .innerJoin(zones, eq(zones.id, taxpayers.communeId))
    .where(and(...conditions))
    .orderBy(asc(taxpayers.taxpayerNo));
  const ids = rows.map((r) => r.tp.id);
  const obligationRows = ids.length
    ? await db.select().from(obligations).where(inArray(obligations.taxpayerId, ids))
    : [];
  const entityRows = ids.length
    ? await db
        .select({ taxpayerId: entities.taxpayerId, categoryLabel: categories.labelFr })
        .from(entities)
        .innerJoin(categories, eq(categories.id, entities.categoryId))
        .where(inArray(entities.taxpayerId, ids))
        .orderBy(asc(entities.registeredAt))
    : [];
  const items: TaxpayerListItem[] = rows.map(({ tp, quartier }) => ({
    taxpayerNo: tp.taxpayerNo,
    fullName: tp.fullName,
    categoryLabel: entityRows.find((e) => e.taxpayerId === tp.id)?.categoryLabel ?? null,
    quartier,
    phone: tp.phone,
    balance: summarizeBalance(
      obligationRows.filter((o) => o.taxpayerId === tp.id),
      day,
    ),
  }));
  const filtered = filters.pill ? items.filter((i) => i.balance.pill === filters.pill) : items;
  const total = filtered.length;
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
}

export async function getTaxpayerDetail(db: Db, taxpayerNo: string, asOf = new Date()) {
  const day = businessDate(asOf);
  const [tp] = await db.select().from(taxpayers).where(eq(taxpayers.taxpayerNo, taxpayerNo));
  if (!tp) return null;
  const [commune] = await db
    .select({ name: zones.name, code: zones.code })
    .from(zones)
    .where(eq(zones.id, tp.communeId));
  const quartier = tp.quartierId
    ? (await db.select({ name: zones.name }).from(zones).where(eq(zones.id, tp.quartierId)))[0]
    : undefined;
  const entityRows = await db
    .select({ entity: entities, categoryLabel: categories.labelFr, categoryCode: categories.code })
    .from(entities)
    .innerJoin(categories, eq(categories.id, entities.categoryId))
    .where(eq(entities.taxpayerId, tp.id))
    .orderBy(asc(entities.registeredAt));
  const obligationRows = await db
    .select({ o: obligations, ruleLabel: taxRules.labelFr, ruleCode: taxRules.code })
    .from(obligations)
    .innerJoin(taxRules, eq(taxRules.id, obligations.taxRuleId))
    .where(eq(obligations.taxpayerId, tp.id))
    .orderBy(desc(obligations.periodStart), asc(taxRules.code));
  const versionIds = [...new Set(obligationRows.map((r) => r.o.taxRuleVersionId))];
  const versions = versionIds.length
    ? await db.query.taxRuleVersions.findMany({
        where: (v, { inArray: inArr }) => inArr(v.id, versionIds),
      })
    : [];
  const obligationsWithPenalty = obligationRows.map(({ o, ruleLabel, ruleCode }) => {
    const version = versions.find((v) => v.id === o.taxRuleVersionId);
    const accrued =
      version && (o.status === "due" || o.status === "partially_paid")
        ? computePenalty(version, o, day)
        : 0;
    return { ...o, ruleLabel, ruleCode, penaltyFc: Math.max(o.penaltyFc, accrued) };
  });
  const paymentRows = await db
    .select({
      p: payments,
      providerReference: providerConfirmations.providerReference,
      receiptNo: receipts.receiptNo,
    })
    .from(payments)
    .leftJoin(providerConfirmations, eq(providerConfirmations.paymentId, payments.id))
    .leftJoin(receipts, eq(receipts.paymentId, payments.id))
    .where(eq(payments.taxpayerId, tp.id))
    .orderBy(desc(payments.createdAt));
  const references = paymentRows.map((r) => r.p.reference);
  const journal = await db
    .select()
    .from(auditLog)
    .where(
      or(
        and(eq(auditLog.objectType, "taxpayer"), eq(auditLog.objectId, tp.taxpayerNo)),
        references.length
          ? and(eq(auditLog.objectType, "payment"), inArray(auditLog.objectId, references))
          : sql`false`,
        and(
          eq(auditLog.objectType, "entity"),
          inArray(auditLog.objectId, entityRows.map((e) => e.entity.id).concat("-")),
        ),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(50);
  const allCategories = await db.select().from(categories).orderBy(asc(categories.sortOrder));
  return {
    taxpayer: tp,
    commune: commune ?? null,
    quartier: quartier?.name ?? null,
    entities: entityRows,
    obligations: obligationsWithPenalty,
    balance: summarizeBalance(obligationsWithPenalty, day),
    payments: paymentRows,
    journal,
    categories: allCategories,
  };
}

const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, "phone must be E.164");

export const updateContactInput = z.object({
  taxpayerNo: z.string().min(1),
  phone: e164,
  address: z.string().trim().min(3).max(200),
});

export async function updateTaxpayerContact(
  db: Db,
  session: AdminSession,
  raw: z.infer<typeof updateContactInput>,
  ctx: RequestContext = {},
) {
  if (!canEditTaxpayer(session.role)) throw new AdminError("forbidden");
  const input = updateContactInput.parse(raw);
  await db.transaction(async (tx) => {
    const [tp] = await tx
      .select()
      .from(taxpayers)
      .where(eq(taxpayers.taxpayerNo, input.taxpayerNo));
    if (!tp) throw new AdminError("not_found", input.taxpayerNo);
    await tx
      .update(taxpayers)
      .set({ phone: input.phone, address: input.address, updatedAt: new Date() })
      .where(eq(taxpayers.id, tp.id));
    await writeAudit(tx, {
      actor: actorOf(session),
      action: "taxpayer.contact_updated",
      object: { type: "taxpayer", id: tp.taxpayerNo },
      details: {
        before: { phone: tp.phone, address: tp.address },
        after: { phone: input.phone, address: input.address },
      },
      where: whereOf(ctx),
      device: deviceOf(ctx),
    });
  });
}

export const changeCategoryInput = z.object({
  entityId: z.uuid(),
  categoryCode: z.string().min(1),
  reason: z.string().trim().min(5).max(500),
});

/** Category change: Superviseur/Administrateur, reason mandatory, audited with the reason (D29). */
export async function changeEntityCategory(
  db: Db,
  session: AdminSession,
  raw: z.infer<typeof changeCategoryInput>,
  ctx: RequestContext = {},
) {
  if (!canEditTaxpayer(session.role)) throw new AdminError("forbidden");
  const input = changeCategoryInput.parse(raw);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ entity: entities, fromCode: categories.code, taxpayerNo: taxpayers.taxpayerNo })
      .from(entities)
      .innerJoin(categories, eq(categories.id, entities.categoryId))
      .innerJoin(taxpayers, eq(taxpayers.id, entities.taxpayerId))
      .where(eq(entities.id, input.entityId));
    if (!row) throw new AdminError("not_found", input.entityId);
    const [to] = await tx.select().from(categories).where(eq(categories.code, input.categoryCode));
    if (!to) throw new AdminError("not_found", input.categoryCode);
    if (to.id === row.entity.categoryId) throw new AdminError("invalid_state", "same category");
    await tx
      .update(entities)
      .set({ categoryId: to.id, updatedAt: new Date() })
      .where(eq(entities.id, row.entity.id));
    await tx.execute(sql`
      insert into app.audit_log (actor_type, actor_id, actor_role, actor_label, action, object_type, object_id, details, reason, ip, user_agent)
      values ('admin', ${session.adminId}, ${session.role}, ${session.email}, 'entity.category_changed', 'entity', ${row.entity.id},
              ${JSON.stringify({ taxpayerNo: row.taxpayerNo, from: row.fromCode, to: to.code })}::jsonb, ${input.reason}, ${ctx.ip ?? null}::inet, ${ctx.userAgent ?? null})
    `);
  });
}
