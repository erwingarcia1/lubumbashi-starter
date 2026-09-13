import { asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { categories, zones } from "@/lib/db/schema";
import { requireAgent } from "@/lib/identity/agent-session";

import { CensusWizard } from "./wizard";

export default async function RegisterPage() {
  const session = await requireAgent();
  const db = getDb();
  const communeRows = await db
    .select({ id: zones.id, code: zones.code, name: zones.name })
    .from(zones)
    .where(eq(zones.level, "commune"))
    .orderBy(asc(zones.name));
  const quartierRows = await db
    .select({ parentId: zones.parentId, code: zones.code, name: zones.name })
    .from(zones)
    .where(eq(zones.level, "quartier"))
    .orderBy(asc(zones.name));
  const categoryRows = await db
    .select({ code: categories.code, label: categories.labelFr })
    .from(categories)
    .orderBy(asc(categories.sortOrder));
  const communes = communeRows.map((c) => ({
    code: c.code,
    name: c.name,
    quartiers: quartierRows
      .filter((q) => q.parentId === c.id)
      .map((q) => ({ code: q.code, name: q.name })),
  }));
  const agentCommune = communeRows.find((c) => c.id === session.communeId)?.code ?? "KAM";
  return (
    <CensusWizard
      communes={communes}
      categories={categoryRows}
      defaultCommune={agentCommune}
      appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
    />
  );
}
