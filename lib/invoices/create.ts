import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { actorOf, deviceOf, whereOf, type RequestContext } from "@/lib/admin/context";
import { AdminError } from "@/lib/admin/errors";
import { writeAudit } from "@/lib/audit/write";
import { loadRules } from "@/lib/census/register";
import type { Db } from "@/lib/db/client";
import {
  categories,
  entities,
  entityRuleOverrides,
  exemptions,
  obligations,
  taxRules,
  taxpayers,
} from "@/lib/db/schema";
import { canIssueInvoice } from "@/lib/identity/roles";
import type { AdminSession } from "@/lib/identity/session";
import { applicableRules, isExempt, type Frequency, type Rule } from "@/lib/tax-engine";
import { businessDate, monthPeriod } from "@/lib/time";

import { baremeFor, frequencyOf, penaltyAtIssue, registrationMonthOf } from "./bareme";
import { issueInvoiceInTx } from "./issue";

/** Shortest justification accepted when the amount leaves the barème (same bar as other reasons). */
const REASON_MIN = 5;

/**
 * What the Mairie user enters for an ad-hoc note de perception (« Nouvelle note de perception »).
 * `periodStart` is the first day of the month chosen; a quarterly or annual rule widens it to the
 * period containing that month. Amounts are integers of FC (invariant 9); the barème applies when
 * `amountFc` is absent, and any other amount needs a `reason`.
 */
export const createObligationInput = z.object({
  taxpayerNo: z.string().trim().min(1).max(40),
  entityId: z.uuid(),
  taxRuleCode: z.string().trim().min(1).max(80),
  periodStart: z.iso.date().regex(/-01$/, "the first day of a month"),
  dueDate: z.iso.date(),
  amountFc: z.number().int().min(0).optional(),
  reason: z.string().trim().max(500).optional(),
  label: z.string().trim().max(120).optional(),
});
export type CreateObligationInput = z.input<typeof createObligationInput>;

export interface CreatedObligation {
  obligationId: string;
  invoiceNo: string;
  amountFc: number;
  /** What the rule version in force would have charged (null never reaches the caller). */
  baremeAmountFc: number;
  versionId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  const code = e?.cause?.code ?? e?.code;
  const name = e?.cause?.constraint ?? e?.constraint;
  return code === "23505" && name === constraint;
}

/**
 * Creates one obligation by hand for a chosen taxpayer and issues its note de perception in the
 * same transaction, for the roles that may issue notes (Finances, Administrateur, Superviseur,
 * Maire; the Auditeur is refused before anything is read). The rule is resolved by code and must
 * apply to the entity the way the engine sees it: its category's rules plus the entity's
 * `entity_rule_overrides` (`applicableRules`), and no exemption of the taxpayer in force on the
 * period's first day (`isExempt`); otherwise `invalid_input` / `rule_not_applicable`. Its version
 * is the one in force on the period's first day (invariant 6; `invalid_state` / `no_version` when
 * none is approved for that date). The month chosen may not precede the entity's registration
 * month (`invalid_input` / `period_before_registration`, D27: no back-dated obligations). The
 * barème comes from `amountFor` for the entity (`invalid_input` / `base_required` for a percent
 * rule without a tax base). The amount entered replaces the barème only with a reason
 * (`invalid_input` / `reason_required`). The same (entity, rule, period) twice is
 * `duplicate_period`, detail = the existing note's number.
 *
 * Journal: one `obligation.created` row (WHO = the admin, WHERE = IP, DEVICE = user agent,
 * details = everything entered plus the barème, the penalty the note is born with when its due
 * date is already past (`penaltyAtIssueFc`, what the snapshot will print) and
 * `source: "back_office"`), then the usual `invoice.issued` row from the issue helper, so the
 * note is born issued in the user's name.
 */
export async function createManualObligation(
  db: Db,
  session: AdminSession,
  raw: CreateObligationInput,
  ctx: RequestContext = {},
  now = new Date(),
): Promise<CreatedObligation> {
  if (!canIssueInvoice(session.role)) throw new AdminError("forbidden");
  const input = createObligationInput.parse(raw);
  // Set once the (entity, rule, period) is known; read if the insert loses a race (see catch).
  const seen: { key: { entityId: string; taxRuleId: string; periodStart: string } | null } = {
    key: null,
  };
  try {
    return await db.transaction(async (tx) => {
      const [tp] = await tx
        .select({ id: taxpayers.id })
        .from(taxpayers)
        .where(eq(taxpayers.taxpayerNo, input.taxpayerNo));
      if (!tp) throw new AdminError("not_found", input.taxpayerNo);
      const [ent] = await tx
        .select()
        .from(entities)
        .where(and(eq(entities.id, input.entityId), eq(entities.taxpayerId, tp.id)));
      if (!ent) throw new AdminError("not_found", input.entityId);
      if (!ent.active || ent.status !== "active") {
        throw new AdminError("invalid_state", "entity_closed");
      }

      const rules = await loadRules(tx as unknown as Db);
      const rule = rules.find((r) => r.code === input.taxRuleCode);
      if (!rule) throw new AdminError("not_found", input.taxRuleCode);
      if (!rule.active) throw new AdminError("invalid_state", "inactive_rule");
      // The rule must apply to this entity as the engine sees it: category ± overrides, and no
      // exemption of the taxpayer in force at the period (checked once the period is known).
      const overrides = await tx
        .select({ taxRuleId: entityRuleOverrides.taxRuleId, kind: entityRuleOverrides.kind })
        .from(entityRuleOverrides)
        .where(eq(entityRuleOverrides.entityId, ent.id));
      if (!applicableRules(ent, rules, overrides).some((r) => r.id === rule.id)) {
        throw new AdminError("invalid_input", "rule_not_applicable");
      }
      // Same derivation as the form (lib/invoices/bareme.ts): period, version in force, amount.
      const bareme = baremeFor(rule, ent.taxBaseFc, input.periodStart);
      const { period, version } = bareme;
      if (!version) throw new AdminError("invalid_state", "no_version");
      // DECISION-PENDING: D27 — obligations start with the period of registration; a month before
      // the entity's registration month is refused (the form's `min` is the same month).
      if (input.periodStart.slice(0, 7) < registrationMonthOf(ent.registeredAt)) {
        throw new AdminError("invalid_input", "period_before_registration");
      }
      const exemptionRows = await tx
        .select({
          taxRuleId: exemptions.taxRuleId,
          validFrom: exemptions.validFrom,
          validTo: exemptions.validTo,
        })
        .from(exemptions)
        .where(eq(exemptions.taxpayerId, tp.id));
      if (isExempt(exemptionRows, rule.id, period.start)) {
        throw new AdminError("invalid_input", "rule_not_applicable");
      }
      if (input.dueDate < period.start) throw new AdminError("invalid_input", "due_date");
      const baremeAmountFc = bareme.amountFc;
      if (baremeAmountFc === null) throw new AdminError("invalid_input", "base_required");
      const amountFc = input.amountFc ?? baremeAmountFc;
      const manualAmount = amountFc !== baremeAmountFc;
      // DECISION-PENDING: D35 — manual amounts and who may issue ad-hoc notes; until the Mairie
      // rules, every issuing role may leave the barème provided it states why (audited).
      if (manualAmount && (input.reason ?? "").length < REASON_MIN) {
        throw new AdminError("invalid_input", "reason_required");
      }
      // A note whose due date is already past is born with the penalty the snapshot will print
      // (the accrual job stores it later); the journal keeps what the issuer was shown.
      const { penaltyFc: penaltyAtIssueFc } = penaltyAtIssue(
        version,
        amountFc,
        input.dueDate,
        businessDate(now),
      );

      seen.key = { entityId: ent.id, taxRuleId: rule.id, periodStart: period.start };
      const [dup] = await tx
        .select({ invoiceNo: obligations.invoiceNo })
        .from(obligations)
        .where(
          and(
            eq(obligations.entityId, ent.id),
            eq(obligations.taxRuleId, rule.id),
            eq(obligations.periodStart, period.start),
          ),
        );
      if (dup) throw new AdminError("duplicate_period", dup.invoiceNo ?? undefined);

      const [row] = await tx
        .insert(obligations)
        .values({
          entityId: ent.id,
          taxpayerId: tp.id,
          taxRuleId: rule.id,
          taxRuleVersionId: version.id,
          periodStart: period.start,
          periodEnd: period.end,
          dueDate: input.dueDate,
          amountFc,
          penaltyFc: 0,
          status: "due",
          updatedAt: now,
        })
        .returning({ id: obligations.id, invoiceNo: obligations.invoiceNo });
      if (!row?.invoiceNo) {
        throw new Error(
          "obligation insert returned no avis number; the database trigger assigns one",
        );
      }
      await writeAudit(tx, {
        actor: actorOf(session),
        action: "obligation.created",
        object: { type: "obligation", id: row.invoiceNo },
        details: {
          obligationId: row.id,
          taxpayerNo: input.taxpayerNo,
          entityId: ent.id,
          taxRuleCode: rule.code,
          versionId: version.id,
          periodStart: period.start,
          periodEnd: period.end,
          dueDate: input.dueDate,
          amountFc,
          baremeAmountFc,
          manualAmount,
          penaltyAtIssueFc,
          reason: manualAmount ? input.reason : null,
          label: input.label || null,
          source: "back_office",
        },
        where: whereOf(ctx),
        device: deviceOf(ctx),
      });
      // Born issued: stamp + `invoice.issued` in the same transaction, in the user's name.
      await issueInvoiceInTx(tx, session, { obligationId: row.id }, ctx, now);
      return {
        obligationId: row.id,
        invoiceNo: row.invoiceNo,
        amountFc,
        baremeAmountFc,
        versionId: version.id,
        periodStart: period.start,
        periodEnd: period.end,
        dueDate: input.dueDate,
      };
    });
  } catch (err) {
    // Two users creating the same note at once: the loser reads the winner's number.
    const k = seen.key;
    if (k && isUniqueViolation(err, "obligations_entity_rule_period_uniq")) {
      const [dup] = await db
        .select({ invoiceNo: obligations.invoiceNo })
        .from(obligations)
        .where(
          and(
            eq(obligations.entityId, k.entityId),
            eq(obligations.taxRuleId, k.taxRuleId),
            eq(obligations.periodStart, k.periodStart),
          ),
        );
      throw new AdminError("duplicate_period", dup?.invoiceNo ?? undefined);
    }
    throw err;
  }
}

/**
 * One active tax rule as the « Nouvelle note » form lists it (labels are data, invariant 8),
 * with its versions so the form derives the barème of any month exactly like the server.
 */
export interface CreatableRule extends Rule {
  labelFr: string;
  categoryLabel: string;
  /** Billing frequency in the current month (the derived-period text and the default choice). */
  frequency: Frequency;
}

export interface CreateOptions {
  rules: CreatableRule[];
  /** Current business month, `YYYY-MM`: the form's default period. */
  month: string;
}

/**
 * What the « Nouvelle note de perception » card needs without a round trip: the active rules with
 * their labels, category and versions (a handful of plain rows). The form prefills the amount
 * with `baremeFor` for the entity and month chosen; the server action recomputes it the same way.
 */
export async function loadCreateOptions(db: Db, now = new Date()): Promise<CreateOptions> {
  const period = monthPeriod(now);
  const labelled = await db
    .select({
      code: taxRules.code,
      labelFr: taxRules.labelFr,
      categoryLabel: categories.labelFr,
    })
    .from(taxRules)
    .innerJoin(categories, eq(categories.id, taxRules.categoryId))
    .where(eq(taxRules.active, true))
    .orderBy(asc(taxRules.taxCode), asc(categories.sortOrder));
  const byCode = new Map((await loadRules(db)).map((r) => [r.code, r]));
  const rules: CreatableRule[] = labelled.flatMap((r) => {
    const rule = byCode.get(r.code);
    return rule
      ? [
          {
            ...rule,
            labelFr: r.labelFr,
            categoryLabel: r.categoryLabel,
            frequency: frequencyOf(rule, period.start),
          },
        ]
      : [];
  });
  return { rules, month: period.start.slice(0, 7) };
}

/**
 * The codes of the rules the form may offer for each entity: its category's rules plus the
 * entity's `entity_rule_overrides`, through the engine's own `applicableRules`, so the select
 * lists exactly what `createManualObligation` will accept (exemptions depend on the period and
 * are checked there). One query for all the entities of the taxpayer.
 */
export async function applicableRuleCodes(
  db: Db,
  ents: Array<Pick<typeof entities.$inferSelect, "id" | "categoryId" | "taxBaseFc" | "active">>,
  rules: Rule[],
): Promise<Record<string, string[]>> {
  const ids = ents.map((e) => e.id);
  const overrides = ids.length
    ? await db
        .select({
          entityId: entityRuleOverrides.entityId,
          taxRuleId: entityRuleOverrides.taxRuleId,
          kind: entityRuleOverrides.kind,
        })
        .from(entityRuleOverrides)
        .where(inArray(entityRuleOverrides.entityId, ids))
    : [];
  return Object.fromEntries(
    ents.map((e) => [
      e.id,
      applicableRules(
        { ...e, registeredAt: new Date(0) },
        rules,
        overrides.filter((o) => o.entityId === e.id),
      ).map((r) => r.code),
    ]),
  );
}
