import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { actorOf, deviceOf, whereOf, type RequestContext } from "@/lib/admin/context";
import { AdminError } from "@/lib/admin/errors";
import { writeAudit } from "@/lib/audit/write";
import type { Db, Tx } from "@/lib/db/client";
import { commissionRules } from "@/lib/db/schema";
import { canEditCommissionRules } from "@/lib/identity/roles";
import type { AdminSession } from "@/lib/identity/session";
import { businessDate } from "@/lib/time";

export type CommissionRuleRow = typeof commissionRules.$inferSelect;
export type CommissionBasis = CommissionRuleRow["basis"];

/** The shape `ruleFor` needs: the database row, or a lighter object in unit tests. */
export interface RuleLike {
  id: string;
  basis: CommissionBasis;
  rateBp: number;
  amountFc: number;
  taxRuleId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * The rule that applies to an act on business day `date` (invariant 6, applied to commissions):
 * the latest version effective on that day — started, not ended, never a future one. A rule
 * bound to the act's tax wins over a global one (`tax_rule_id` null).
 */
export function ruleFor<R extends RuleLike>(
  rules: readonly R[],
  basis: CommissionBasis,
  date: string,
  taxRuleId: string | null = null,
): R | null {
  let best: R | null = null;
  for (const r of rules) {
    if (r.basis !== basis) continue;
    if (r.effectiveFrom > date) continue;
    if (r.effectiveTo !== null && r.effectiveTo <= date) continue;
    if (r.taxRuleId !== null && r.taxRuleId !== taxRuleId) continue;
    if (!best) {
      best = r;
      continue;
    }
    const specific = r.taxRuleId !== null;
    const bestSpecific = best.taxRuleId !== null;
    if (specific !== bestSpecific) {
      if (specific) best = r;
      continue;
    }
    if (r.effectiveFrom > best.effectiveFrom) best = r;
  }
  return best;
}

// DECISION-PENDING: D22 — percentages in basis points, rounded half up to the franc.
/** Commission on `baseFc` at `rateBp` (basis points), integer FC, half up. */
export function commissionAmount(baseFc: number, rateBp: number): number {
  if (!Number.isInteger(baseFc) || !Number.isInteger(rateBp))
    throw new TypeError("commissionAmount: integers only");
  if (baseFc < 0 || rateBp < 0) throw new RangeError("commissionAmount: non-negative only");
  return Math.floor((baseFc * rateBp + 5000) / 10000);
}

export async function listRules(db: Db | Tx): Promise<CommissionRuleRow[]> {
  return db
    .select()
    .from(commissionRules)
    .orderBy(asc(commissionRules.code), desc(commissionRules.effectiveFrom));
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createRuleInput = z
  .object({
    basis: z.enum(["collection_percent", "registration_fixed"]),
    /** Basis points of the amount collected (collection_percent). */
    rateBp: z.number().int().min(0).max(10_000).optional(),
    /** Integer FC per act (registration_fixed). */
    amountFc: z.number().int().nonnegative().optional(),
    effectiveFrom: isoDate,
  })
  .refine((v) => (v.basis === "collection_percent" ? v.rateBp !== undefined : true), {
    message: "rateBp required for collection_percent",
    path: ["rateBp"],
  })
  .refine((v) => (v.basis === "registration_fixed" ? v.amountFc !== undefined : true), {
    message: "amountFc required for registration_fixed",
    path: ["amountFc"],
  });
export type CreateRuleInput = z.infer<typeof createRuleInput>;

/**
 * A new version of the scale is a new row that starts on a future day (invariant 6): existing
 * rows are never edited, statements already approved keep their lines. Administrateur only.
 * The code and French label follow the latest version with the same basis.
 */
export async function createCommissionRule(
  db: Db,
  session: AdminSession,
  raw: CreateRuleInput,
  ctx: RequestContext = {},
): Promise<CommissionRuleRow> {
  if (!canEditCommissionRules(session.role)) throw new AdminError("forbidden");
  const input = createRuleInput.parse(raw);
  const today = businessDate(new Date());
  if (input.effectiveFrom <= today)
    throw new AdminError("invalid_input", "effective_from must be in the future");
  // DECISION-PENDING: D36 — one code per basis until the Mairie's scheme names its rules.
  const code = input.basis;
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select()
      .from(commissionRules)
      .where(eq(commissionRules.code, code))
      .orderBy(desc(commissionRules.effectiveFrom))
      .limit(1);
    const [existing] = await tx
      .select({ id: commissionRules.id })
      .from(commissionRules)
      .where(
        and(eq(commissionRules.code, code), eq(commissionRules.effectiveFrom, input.effectiveFrom)),
      );
    if (existing)
      throw new AdminError("invalid_state", "a version already exists for this effective date");
    const [created] = await tx
      .insert(commissionRules)
      .values({
        code,
        labelFr: latest?.labelFr ?? code,
        basis: input.basis,
        rateBp: input.basis === "collection_percent" ? input.rateBp! : 0,
        amountFc: input.basis === "registration_fixed" ? input.amountFc! : 0,
        taxRuleId: latest?.taxRuleId ?? null,
        effectiveFrom: input.effectiveFrom,
        createdByAdminId: session.adminId,
      })
      .returning();
    await writeAudit(tx, {
      actor: actorOf(session),
      action: "commission_rule.created",
      object: { type: "commission_rule", id: `${code}@${input.effectiveFrom}` },
      details: {
        ruleId: created!.id,
        basis: input.basis,
        rateBp: created!.rateBp,
        amountFc: created!.amountFc,
        effectiveFrom: input.effectiveFrom,
        previousRuleId: latest?.id ?? null,
      },
      where: whereOf(ctx),
      device: deviceOf(ctx),
    });
    return created!;
  });
}
