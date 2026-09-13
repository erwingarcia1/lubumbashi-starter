import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";

import { createDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { formatFC } from "@/lib/i18n/format";
import { computeObligations, computePenalty, type Rule } from "@/lib/tax-engine";
import { businessDate } from "@/lib/time";

/** M2 demo: what the engine says each seeded entity owes as of now (does not write anything). */
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set; see .env.example");
  const db = createDb(url);
  try {
    const asOf = new Date();
    const ruleRows = await db.select().from(s.taxRules);
    const versionRows = await db.select().from(s.taxRuleVersions);
    const rules: Rule[] = ruleRows.map((r) => ({
      id: r.id,
      code: r.code,
      taxCode: r.taxCode,
      categoryId: r.categoryId,
      active: r.active,
      versions: versionRows.filter((v) => v.taxRuleId === r.id),
    }));
    const entities = await db
      .select({ e: s.entities, taxpayerNo: s.taxpayers.taxpayerNo, name: s.taxpayers.fullName })
      .from(s.entities)
      .innerJoin(s.taxpayers, eq(s.taxpayers.id, s.entities.taxpayerId));
    for (const { e, taxpayerNo, name } of entities) {
      const overrides = await db
        .select()
        .from(s.entityRuleOverrides)
        .where(eq(s.entityRuleOverrides.entityId, e.id));
      const exemptions = await db
        .select()
        .from(s.exemptions)
        .where(eq(s.exemptions.taxpayerId, e.taxpayerId));
      const { obligations, skipped } = computeObligations({
        entity: {
          id: e.id,
          categoryId: e.categoryId,
          taxBaseFc: e.taxBaseFc,
          registeredAt: e.registeredAt,
          active: e.active,
        },
        rules,
        overrides,
        exemptions: exemptions.map((x) => ({
          taxRuleId: x.taxRuleId,
          validFrom: x.validFrom,
          validTo: x.validTo,
        })),
        asOf,
      });
      console.log(`\n${taxpayerNo} · ${name} · ${e.name}`);
      const rows = obligations.map((o) => {
        const rule = rules.find((r) => r.id === o.taxRuleId)!;
        const version = rule.versions.find((v) => v.id === o.taxRuleVersionId)!;
        return {
          taxe: rule.code,
          période: `${o.periodStart} → ${o.periodEnd}`,
          échéance: o.dueDate,
          montant: formatFC(o.amountFc),
          pénalité: formatFC(computePenalty(version, o, businessDate(asOf))),
        };
      });
      console.table(rows);
      if (skipped.length)
        console.log(
          "  ignorés :",
          skipped.map((x) => `${x.taxRuleId.slice(0, 8)} ${x.periodStart} ${x.reason}`).join("; "),
        );
    }
  } finally {
    await db.$client.end();
  }
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
