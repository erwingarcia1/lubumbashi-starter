import { and, asc, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "@/lib/audit/write";
import type { Db } from "@/lib/db/client";
import { categories, taxRuleVersions, taxRules } from "@/lib/db/schema";
import { canApproveRuleVersion, canProposeRuleVersion } from "@/lib/identity/roles";
import type { AdminSession } from "@/lib/identity/session";
import { businessDate } from "@/lib/time";

import { actorOf, deviceOf, whereOf, type RequestContext } from "./context";
import { AdminError } from "./errors";
import { getApprovalPolicy } from "./settings";

export type RuleVersionRow = typeof taxRuleVersions.$inferSelect;

export interface RuleListItem {
  id: string;
  code: string;
  taxCode: string;
  labelFr: string;
  categoryLabel: string;
  active: boolean;
  /** Version in force today (approved, effective, not ended). */
  current: RuleVersionRow | null;
  /** Approved version that starts in the future, if any. */
  upcoming: RuleVersionRow | null;
  draftCount: number;
}

/** Version in force on a day: approved (or superseded), started, not ended. */
export function versionInForce(versions: RuleVersionRow[], day: string): RuleVersionRow | null {
  let best: RuleVersionRow | null = null;
  for (const v of versions) {
    if (v.status === "draft" || v.effectiveFrom > day) continue;
    if (v.effectiveTo !== null && v.effectiveTo <= day) continue;
    if (!best || v.effectiveFrom > best.effectiveFrom) best = v;
  }
  return best;
}

export async function listRules(db: Db, asOf = new Date()): Promise<RuleListItem[]> {
  const day = businessDate(asOf);
  const rules = await db
    .select({
      rule: taxRules,
      categoryLabel: categories.labelFr,
      categorySort: categories.sortOrder,
    })
    .from(taxRules)
    .innerJoin(categories, eq(categories.id, taxRules.categoryId))
    .orderBy(asc(taxRules.taxCode), asc(categories.sortOrder));
  const versions = await db.select().from(taxRuleVersions).orderBy(asc(taxRuleVersions.version));
  return rules.map(({ rule, categoryLabel }) => {
    const own = versions.filter((v) => v.taxRuleId === rule.id);
    const current = versionInForce(own, day);
    const upcoming =
      own
        .filter((v) => v.status === "approved" && v.effectiveFrom > day)
        .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0] ?? null;
    return {
      id: rule.id,
      code: rule.code,
      taxCode: rule.taxCode,
      labelFr: rule.labelFr,
      categoryLabel,
      active: rule.active,
      current,
      upcoming,
      draftCount: own.filter((v) => v.status === "draft").length,
    };
  });
}

export async function getRuleWithVersions(db: Db, code: string) {
  const [row] = await db
    .select({ rule: taxRules, categoryLabel: categories.labelFr })
    .from(taxRules)
    .innerJoin(categories, eq(categories.id, taxRules.categoryId))
    .where(eq(taxRules.code, code));
  if (!row) return null;
  const versions = await db
    .select()
    .from(taxRuleVersions)
    .where(eq(taxRuleVersions.taxRuleId, row.rule.id))
    .orderBy(desc(taxRuleVersions.version));
  return { ...row, versions };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const proposeVersionInput = z.object({
  ruleCode: z.string().min(1),
  amountFc: z.number().int().nonnegative(),
  effectiveFrom: isoDate,
  penaltyRateBp: z.number().int().nonnegative().nullable(),
  graceDays: z.number().int().nonnegative(),
  referenceDocument: z.string().trim().max(200).optional(),
  notesFr: z.string().trim().max(1000).optional(),
});
export type ProposeVersionInput = z.infer<typeof proposeVersionInput>;

/**
 * A rate change is a new draft version (invariant 6): nothing already issued changes, and the
 * version becomes effective only once approved by someone the policy allows.
 */
export async function proposeRuleVersion(
  db: Db,
  session: AdminSession,
  raw: ProposeVersionInput,
  ctx: RequestContext = {},
): Promise<{ versionId: string; version: number }> {
  if (!canProposeRuleVersion(session.role)) throw new AdminError("forbidden");
  const input = proposeVersionInput.parse(raw);
  const today = businessDate(new Date());
  if (input.effectiveFrom <= today)
    throw new AdminError("invalid_input", "effective_from must be in the future");
  return db.transaction(async (tx) => {
    const [rule] = await tx.select().from(taxRules).where(eq(taxRules.code, input.ruleCode));
    if (!rule) throw new AdminError("not_found", input.ruleCode);
    const own = await tx
      .select()
      .from(taxRuleVersions)
      .where(eq(taxRuleVersions.taxRuleId, rule.id))
      .orderBy(desc(taxRuleVersions.version));
    const latest = own[0];
    if (!latest) throw new AdminError("invalid_state", "rule has no version to derive from");
    if (latest.calcKind !== "fixed")
      throw new AdminError("invalid_state", "only fixed-amount rules can be edited in M3");
    const [existing] = await tx
      .select({ id: taxRuleVersions.id })
      .from(taxRuleVersions)
      .where(
        and(
          eq(taxRuleVersions.taxRuleId, rule.id),
          eq(taxRuleVersions.effectiveFrom, input.effectiveFrom),
        ),
      );
    if (existing)
      throw new AdminError("invalid_state", "a version already exists for this effective date");
    const [created] = await tx
      .insert(taxRuleVersions)
      .values({
        taxRuleId: rule.id,
        version: latest.version + 1,
        status: "draft",
        effectiveFrom: input.effectiveFrom,
        calcKind: "fixed",
        amountFc: input.amountFc,
        frequency: latest.frequency,
        dueDay: latest.dueDay,
        penaltyKind:
          input.penaltyRateBp === null
            ? "none"
            : latest.penaltyKind === "none"
              ? "once_percent"
              : latest.penaltyKind,
        penaltyRateBp: input.penaltyRateBp,
        penaltyAmountFc: null,
        graceDays: input.graceDays,
        penaltyCapBp: latest.penaltyCapBp,
        referenceDocument: input.referenceDocument || null,
        notesFr: input.notesFr || null,
        proposedByAdminId: session.adminId,
      })
      .returning({ id: taxRuleVersions.id, version: taxRuleVersions.version });
    await writeAudit(tx, {
      actor: actorOf(session),
      action: "tax_rule_version.proposed",
      object: { type: "tax_rule_version", id: `${rule.code}#${created!.version}` },
      details: {
        ruleCode: rule.code,
        amountFc: input.amountFc,
        effectiveFrom: input.effectiveFrom,
        penaltyRateBp: input.penaltyRateBp,
        graceDays: input.graceDays,
      },
      where: whereOf(ctx),
      device: deviceOf(ctx),
    });
    return { versionId: created!.id, version: created!.version };
  });
}

/** Approval by a role the policy allows, never by the proposer when self-approval is forbidden. */
export async function approveRuleVersion(
  db: Db,
  session: AdminSession,
  versionId: string,
  ctx: RequestContext = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    const policy = await getApprovalPolicy(tx);
    const [version] = await tx
      .select()
      .from(taxRuleVersions)
      .where(eq(taxRuleVersions.id, versionId));
    if (!version) throw new AdminError("not_found", versionId);
    const verdict = canApproveRuleVersion(
      policy,
      { adminId: session.adminId, role: session.role },
      version,
    );
    if (!verdict.ok)
      throw new AdminError(verdict.reason === "self" ? "self_approval" : "forbidden");
    if (version.status !== "draft")
      throw new AdminError("invalid_state", `version is ${version.status}`);
    const [rule] = await tx.select().from(taxRules).where(eq(taxRules.id, version.taxRuleId));
    // Versions already approved and still open end when the new one starts (issued obligations keep theirs).
    await tx
      .update(taxRuleVersions)
      .set({ effectiveTo: version.effectiveFrom, status: "superseded" })
      .where(
        and(
          eq(taxRuleVersions.taxRuleId, version.taxRuleId),
          eq(taxRuleVersions.status, "approved"),
          isNull(taxRuleVersions.effectiveTo),
          lt(taxRuleVersions.effectiveFrom, version.effectiveFrom),
        ),
      );
    await tx
      .update(taxRuleVersions)
      .set({ status: "approved", approvedByAdminId: session.adminId, approvedAt: sql`now()` })
      .where(eq(taxRuleVersions.id, versionId));
    await writeAudit(tx, {
      actor: actorOf(session),
      action: "tax_rule_version.approved",
      object: {
        type: "tax_rule_version",
        id: `${rule?.code ?? version.taxRuleId}#${version.version}`,
      },
      details: {
        amountFc: version.amountFc,
        effectiveFrom: version.effectiveFrom,
        proposedByAdminId: version.proposedByAdminId,
      },
      where: whereOf(ctx),
      device: deviceOf(ctx),
    });
  });
}
