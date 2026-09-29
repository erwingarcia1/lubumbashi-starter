import {
  amountFor,
  computePenalty,
  dueDateFor,
  periodsBetween,
  versionFor,
  type Frequency,
  type Rule,
  type RuleVersion,
} from "@/lib/tax-engine";
import { businessDate, daysLate, type Period } from "@/lib/time";

/**
 * Pure helpers shared by the server (`create.ts`) and the « Nouvelle note de perception » form:
 * both derive the period, the version in force and the barème from the same functions of the
 * tax engine, so the amount prefilled in the browser is the amount the server will compare
 * against. Nothing here touches the database.
 */

function toYearMonth(isoDate: string): { year: number; month: number } {
  const [year, month] = isoDate.split("-").map(Number) as [number, number];
  return { year, month };
}

/** The period of `frequency` that contains the month starting on `monthStart` (YYYY-MM-01). */
export function periodContaining(frequency: Frequency, monthStart: string): Period {
  const ym = toYearMonth(monthStart);
  const [period] = periodsBetween(frequency, ym, ym);
  if (!period) throw new Error(`no ${frequency} period contains ${monthStart}`);
  return period;
}

/** The frequency a rule bills at: its version in force on `day`, else its first version. */
export function frequencyOf(rule: Rule, day: string): Frequency {
  return versionFor(rule, day)?.frequency ?? rule.versions[0]?.frequency ?? "monthly";
}

export interface Bareme {
  /** The period the note covers: the month, or the quarter / year containing it. */
  period: Period;
  /** The version in force on the period's first day (invariant 6), null when none is approved. */
  version: RuleVersion | null;
  /** What that version charges the entity; null without a version or without a tax base. */
  amountFc: number | null;
  skipped: "no_version" | "no_tax_base" | null;
  /** Due date the rule prescribes for the period (its last day unless the version says otherwise). */
  dueDate: string;
}

/**
 * The barème of one rule for one entity and one month: period, version in force, amount. The
 * entity is only its tax base here (`amountFor` reads nothing else), so the browser can call
 * this with what the form knows.
 */
export function baremeFor(rule: Rule, taxBaseFc: number | null, monthStart: string): Bareme {
  const period = periodContaining(frequencyOf(rule, monthStart), monthStart);
  const version = versionFor(rule, period.start);
  if (!version) {
    return { period, version: null, amountFc: null, skipped: "no_version", dueDate: period.end };
  }
  const amountFc = amountFor(version, {
    id: "",
    categoryId: rule.categoryId,
    taxBaseFc,
    registeredAt: new Date(0),
    active: true,
  });
  return {
    period,
    version,
    amountFc,
    skipped: amountFc === null ? "no_tax_base" : null,
    dueDate: dueDateFor(period, version.dueDay),
  };
}

/**
 * The business month (`YYYY-MM`, Africa/Lubumbashi) an entity was registered in: the first month
 * a note may cover (the form's `min`, the server's floor). An annual or quarterly note chosen for
 * that month covers the period containing it, exactly as `computeObligations` starts.
 */
// DECISION-PENDING: D27 — liability starts with the period of registration, never earlier.
export function registrationMonthOf(registeredAt: Date): string {
  return businessDate(registeredAt).slice(0, 7);
}

export interface PenaltyAtIssue {
  /** Days between the due date and `today` (0 when the due date has not passed). */
  daysLate: number;
  /** Penalty the version prescribes as of `today`; 0 within the grace period or without penalty. */
  penaltyFc: number;
}

/**
 * What a note is born owing on top of its principal when its due date is already past on
 * `today` (a missed past period): the engine's own `computePenalty`, so the line the form shows
 * and the figure the server journals are the same one the snapshot prints later.
 */
export function penaltyAtIssue(
  version: Pick<
    RuleVersion,
    "penaltyKind" | "penaltyRateBp" | "penaltyAmountFc" | "graceDays" | "penaltyCapBp"
  >,
  amountFc: number,
  dueDate: string,
  today: string,
): PenaltyAtIssue {
  return {
    daysLate: daysLate(dueDate, today),
    penaltyFc: computePenalty(version, { dueDate, amountFc }, today),
  };
}
