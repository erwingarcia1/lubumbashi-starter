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

export type RuleState = "active" | "upcoming" | "superseded";

/**
 * How a version reads on the scale table on `today`: the one `ruleFor` would pay an act with
 * today is active; one that starts later is upcoming; anything else has been replaced (ended,
 * or older than the version in force).
 */
export function ruleState<R extends RuleLike>(
  rules: readonly R[],
  rule: R,
  today: string,
): RuleState {
  if (ruleFor(rules, rule.basis, today, rule.taxRuleId)?.id === rule.id) return "active";
  if (rule.effectiveFrom > today) return "upcoming";
  return "superseded";
}

/**
 * The day a version stops applying: its `effectiveTo`, else the start of the next version of
 * the same chain (same basis and tax), else null while it is open-ended.
 */
export function ruleEndOf<R extends RuleLike & { id: string }>(
  rules: readonly R[],
  rule: R,
): string | null {
  if (rule.effectiveTo !== null) return rule.effectiveTo;
  let next: string | null = null;
  for (const r of rules) {
    if (r.id === rule.id || r.basis !== rule.basis || r.taxRuleId !== rule.taxRuleId) continue;
    if (r.effectiveFrom <= rule.effectiveFrom) continue;
    if (next === null || r.effectiveFrom < next) next = r.effectiveFrom;
  }
  return next;
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
 * rows keep their values, statements already approved keep their lines. Administrateur only.
 * The code, French label and tax follow the latest version with the same basis; that version
 * ends the day the new one starts (like `approveRuleVersion` for tax rules), so one version at
 * most is in force on any day. A version dated on or before the latest one is refused.
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
    if (latest && input.effectiveFrom <= latest.effectiveFrom)
      throw new AdminError(
        "invalid_input",
        `effective_from must be after the latest version (${latest.effectiveFrom})`,
      );
    // The open latest version (same code, same tax) ends when the new one starts.
    const supersedes =
      latest && latest.effectiveTo === null && latest.effectiveFrom < input.effectiveFrom
        ? latest
        : null;
    if (supersedes)
      await tx
        .update(commissionRules)
        .set({ effectiveTo: input.effectiveFrom })
        .where(eq(commissionRules.id, supersedes.id));
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
        // The version whose effective_to was set to this date, if any.
        supersededRuleId: supersedes?.id ?? null,
      },
      where: whereOf(ctx),
      device: deviceOf(ctx),
    });
    return created!;
  });
}
