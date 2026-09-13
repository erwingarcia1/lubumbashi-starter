/** Inputs of the tax engine: plain data mirroring the `app` schema, never database handles. */
export type Frequency = "monthly" | "quarterly" | "annual";
export type CalcKind = "fixed" | "percent_of_base";
export type PenaltyKind = "none" | "once_percent" | "once_fixed" | "monthly_percent";
export type VersionStatus = "draft" | "approved" | "superseded";

export interface RuleVersion {
  id: string;
  taxRuleId: string;
  version: number;
  status: VersionStatus;
  /** ISO dates (YYYY-MM-DD), business calendar. */
  effectiveFrom: string;
  effectiveTo: string | null;
  calcKind: CalcKind;
  amountFc: number | null;
  rateBp: number | null;
  frequency: Frequency;
  /** Day of the period's last month the obligation is due; null = last day of the period. */
  dueDay: number | null;
  penaltyKind: PenaltyKind;
  penaltyRateBp: number | null;
  penaltyAmountFc: number | null;
  graceDays: number;
  penaltyCapBp: number | null;
}

export interface Rule {
  id: string;
  code: string;
  taxCode: string;
  categoryId: string;
  active: boolean;
  versions: RuleVersion[];
}

export interface EntityInput {
  id: string;
  categoryId: string;
  taxBaseFc: number | null;
  registeredAt: Date;
  active: boolean;
}

export interface Override {
  taxRuleId: string;
  kind: "include" | "exclude";
}

export interface Exemption {
  /** null = every tax. */
  taxRuleId: string | null;
  validFrom: string;
  validTo: string | null;
}

export interface ObligationDraft {
  entityId: string;
  taxRuleId: string;
  taxRuleVersionId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  amountFc: number;
}

export interface SkippedPeriod {
  taxRuleId: string;
  periodStart: string;
  reason: "no_version" | "no_tax_base" | "exempt";
}

export interface ObligationBalance {
  id: string;
  dueDate: string;
  amountFc: number;
  penaltyFc: number;
  paidFc: number;
}

export interface Allocation {
  obligationId: string;
  kind: "principal" | "penalty";
  amountFc: number;
}
