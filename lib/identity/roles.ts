import { z } from "zod";

/** Mairie roles (docs/ROLES.md). Agents and taxpayers are separate identities. */
export const ADMIN_ROLES = [
  "administrateur",
  "maire",
  "finances",
  "superviseur",
  "auditeur",
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Who may approve a tax rule version; stored in app.settings (`rule_version_approval`). */
export const approvalPolicySchema = z.object({
  roles: z.array(z.enum(ADMIN_ROLES)).min(1),
  forbidSelfApproval: z.boolean(),
});
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;

// DECISION-PENDING: D29 — default policy until the Mairie sets its own in Réglages.
export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  roles: ["finances", "administrateur"],
  forbidSelfApproval: true,
};

export function canProposeRuleVersion(role: AdminRole): boolean {
  return role === "finances" || role === "administrateur";
}

export type ApprovalVerdict = { ok: true } | { ok: false; reason: "role" | "self" };

export function canApproveRuleVersion(
  policy: ApprovalPolicy,
  approver: { adminId: string; role: AdminRole },
  version: { proposedByAdminId: string | null },
): ApprovalVerdict {
  if (!policy.roles.includes(approver.role)) return { ok: false, reason: "role" };
  if (policy.forbidSelfApproval && version.proposedByAdminId === approver.adminId) {
    return { ok: false, reason: "self" };
  }
  return { ok: true };
}

/** Contact corrections and category changes: Superviseur and Administrateur (ROLES.md). */
export function canEditTaxpayer(role: AdminRole): boolean {
  return role === "superviseur" || role === "administrateur";
}

export function canReadRegistry(role: AdminRole): boolean {
  return ADMIN_ROLES.includes(role);
}

/** Runs the reconciliation, resolves exceptions and closes the day: Finances and Administrateur. */
export function canReconcile(role: AdminRole): boolean {
  return role === "finances" || role === "administrateur";
}

/** Issues (prints) a note de perception from the back office: Finances, Administrateur, Superviseur (D35). */
export function canIssueInvoice(role: AdminRole): boolean {
  return role === "finances" || role === "administrateur" || role === "superviseur";
}

/** Reads an agent's field activity (positions, trail, stops): Superviseur, Administrateur, Maire, Auditeur (D38). */
export function canViewTracking(role: AdminRole): boolean {
  return (
    role === "superviseur" || role === "administrateur" || role === "maire" || role === "auditeur"
  );
}

// DECISION-PENDING: D36 — who approves and pays the agents' monthly commission statements.
/** Recomputes, approves and marks paid the commission statements: Finances and Administrateur. */
export function canManageCommissions(role: AdminRole): boolean {
  return role === "finances" || role === "administrateur";
}

/** Maintains the commission scale (new versions of `commission_rules`): Administrateur only. */
export function canEditCommissionRules(role: AdminRole): boolean {
  return role === "administrateur";
}
