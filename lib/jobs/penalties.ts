import { and, eq, inArray } from "drizzle-orm";

import { writeAudit } from "@/lib/audit/write";
import type { Db } from "@/lib/db/client";
import { obligations, taxRuleVersions } from "@/lib/db/schema";
import { computePenalty } from "@/lib/tax-engine";
import { businessDate } from "@/lib/time";

/**
 * Daily penalty accrual: writes the engine's penalty for every open obligation whose penalty
 * grew (never lowers one). Until this runs, screens compute the accrued penalty on the fly.
 */
export async function accruePenalties(
  db: Db,
  now = new Date(),
  /** Restrict to some taxpayers (tests); the nightly job covers everyone. */
  taxpayerIds?: string[],
): Promise<{ updated: number; addedFc: number; asOf: string }> {
  const asOf = businessDate(now);
  const open = await db
    .select()
    .from(obligations)
    .where(
      taxpayerIds
        ? and(
            inArray(obligations.status, ["due", "partially_paid"]),
            inArray(obligations.taxpayerId, taxpayerIds),
          )
        : inArray(obligations.status, ["due", "partially_paid"]),
    );
  const versionIds = [...new Set(open.map((o) => o.taxRuleVersionId))];
  const versions = versionIds.length
    ? await db.select().from(taxRuleVersions).where(inArray(taxRuleVersions.id, versionIds))
    : [];
  let updated = 0;
  let addedFc = 0;
  await db.transaction(async (tx) => {
    for (const o of open) {
      const version = versions.find((v) => v.id === o.taxRuleVersionId);
      if (!version) continue;
      const penaltyFc = computePenalty(version, o, asOf);
      if (penaltyFc <= o.penaltyFc) continue;
      await tx
        .update(obligations)
        .set({ penaltyFc, updatedAt: now })
        .where(and(eq(obligations.id, o.id), eq(obligations.penaltyFc, o.penaltyFc)));
      updated += 1;
      addedFc += penaltyFc - o.penaltyFc;
    }
    if (updated > 0) {
      await writeAudit(tx, {
        actor: { type: "system" },
        action: "penalties.accrued",
        object: { type: "job", id: `penalties/${asOf}` },
        details: { asOf, updated, addedFc },
      });
    }
  });
  return { updated, addedFc, asOf };
}
