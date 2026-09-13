import { eq } from "drizzle-orm";

import type { Db, Tx } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import {
  DEFAULT_APPROVAL_POLICY,
  approvalPolicySchema,
  type ApprovalPolicy,
} from "@/lib/identity/roles";

export const RULE_VERSION_APPROVAL_KEY = "rule_version_approval";

/** Approval policy from app.settings, or the default when absent or malformed. */
export async function getApprovalPolicy(db: Db | Tx): Promise<ApprovalPolicy> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, RULE_VERSION_APPROVAL_KEY));
  if (!row) return DEFAULT_APPROVAL_POLICY;
  const parsed = approvalPolicySchema.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT_APPROVAL_POLICY;
}
