import { describe, expect, it } from "vitest";

import {
  DEFAULT_APPROVAL_POLICY,
  approvalPolicySchema,
  canApproveRuleVersion,
  canEditTaxpayer,
  canProposeRuleVersion,
} from "@/lib/identity/roles";

const finances = { adminId: "a1", role: "finances" as const };
const admin = { adminId: "a2", role: "administrateur" as const };
const auditeur = { adminId: "a3", role: "auditeur" as const };

describe("approval policy (D29 placeholder)", () => {
  it("lets Finances and the Administrateur approve, never the proposer", () => {
    const v = { proposedByAdminId: "a1" };
    expect(canApproveRuleVersion(DEFAULT_APPROVAL_POLICY, finances, v)).toEqual({
      ok: false,
      reason: "self",
    });
    expect(canApproveRuleVersion(DEFAULT_APPROVAL_POLICY, admin, v)).toEqual({ ok: true });
    expect(
      canApproveRuleVersion(DEFAULT_APPROVAL_POLICY, { adminId: "a9", role: "finances" }, v),
    ).toEqual({ ok: true });
    expect(canApproveRuleVersion(DEFAULT_APPROVAL_POLICY, auditeur, v)).toEqual({
      ok: false,
      reason: "role",
    });
  });
  it("is customisable: roles list and self-approval switch", () => {
    const custom = approvalPolicySchema.parse({ roles: ["finances"], forbidSelfApproval: false });
    expect(canApproveRuleVersion(custom, finances, { proposedByAdminId: "a1" })).toEqual({
      ok: true,
    });
    expect(canApproveRuleVersion(custom, admin, { proposedByAdminId: null })).toEqual({
      ok: false,
      reason: "role",
    });
    expect(() => approvalPolicySchema.parse({ roles: [], forbidSelfApproval: true })).toThrow();
    expect(() =>
      approvalPolicySchema.parse({ roles: ["mayor"], forbidSelfApproval: true }),
    ).toThrow();
  });
  it("proposal and taxpayer edits follow the ROLES.md matrix", () => {
    expect(canProposeRuleVersion("finances")).toBe(true);
    expect(canProposeRuleVersion("administrateur")).toBe(true);
    expect(canProposeRuleVersion("superviseur")).toBe(false);
    expect(canEditTaxpayer("superviseur")).toBe(true);
    expect(canEditTaxpayer("administrateur")).toBe(true);
    expect(canEditTaxpayer("finances")).toBe(false);
    expect(canEditTaxpayer("maire")).toBe(false);
  });
});
