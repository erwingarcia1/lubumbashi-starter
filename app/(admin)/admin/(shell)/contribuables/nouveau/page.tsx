import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

import { categoriesForRegistration } from "@/lib/admin/register";
import { getDb } from "@/lib/db/client";
import { zones } from "@/lib/db/schema";
import { canEditTaxpayer } from "@/lib/identity/roles";
import { requireAdmin } from "@/lib/identity/session";
import { t } from "@/lib/i18n";

import { createTaxpayerAction } from "./actions";
import { NewTaxpayerForm } from "./new-taxpayer-form";

const C = t.admin.taxpayers.create;

/** Registration from the Mairie dashboard (Superviseur, Administrateur): same service as the census. */
export default async function NewTaxpayerPage() {
  const session = await requireAdmin();
  if (!canEditTaxpayer(session.role)) redirect("/admin/interdit");
  const db = getDb();
  const [communeRows, quartierRows, categories] = await Promise.all([
    db
      .select({ id: zones.id, code: zones.code, name: zones.name })
      .from(zones)
      .where(eq(zones.level, "commune"))
      .orderBy(asc(zones.name)),
    db
      .select({ parentId: zones.parentId, code: zones.code, name: zones.name })
      .from(zones)
      .where(eq(zones.level, "quartier"))
      .orderBy(asc(zones.name)),
    categoriesForRegistration(db),
  ]);
  const communes = communeRows.map((c) => ({
    code: c.code,
    name: c.name,
    quartiers: quartierRows
      .filter((q) => q.parentId === c.id)
      .map((q) => ({ code: q.code, name: q.name })),
  }));
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/contribuables"
          className="inline-flex min-h-11 items-center text-[12.5px] text-[#C1121F] underline md:min-h-0"
        >
          ← {t.common.back}
        </Link>
        <h2 className="text-lg font-bold">{C.title}</h2>
      </div>
      <NewTaxpayerForm
        action={createTaxpayerAction}
        clientUuid={randomUUID()}
        communes={communes}
        categories={categories}
        defaultCommune="KAM"
        maptilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY ?? null}
      />
    </>
  );
}
