import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import { entities, obligations, taxRules, taxpayers } from "@/lib/db/schema";

export function invoiceUrlFor(
  invoiceNo: string,
  token: string,
  appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "",
): string {
  return `${appUrl.replace(/\/$/, "")}/f/${invoiceNo}/${token}`;
}

/**
 * The avis d'imposition behind a QR (screen p-invoice): number + token must both match, like a
 * receipt. Returns the obligation with its taxpayer, entity and rule label.
 */
export async function findInvoice(db: Db, invoiceNo: string, token?: string) {
  if (!/^AV-\d{4}-\d{6}$/.test(invoiceNo)) return null;
  const [row] = await db
    .select({
      obligation: obligations,
      ruleLabelFr: taxRules.labelFr,
      taxpayer: {
        id: taxpayers.id,
        taxpayerNo: taxpayers.taxpayerNo,
        fullName: taxpayers.fullName,
        phone: taxpayers.phone,
        status: taxpayers.status,
      },
      entityName: entities.name,
      entityAddress: entities.address,
    })
    .from(obligations)
    .innerJoin(taxRules, eq(taxRules.id, obligations.taxRuleId))
    .innerJoin(taxpayers, eq(taxpayers.id, obligations.taxpayerId))
    .innerJoin(entities, eq(entities.id, obligations.entityId))
    .where(eq(obligations.invoiceNo, invoiceNo));
  if (!row) return null;
  if (token !== undefined && token !== row.obligation.invoiceToken) return null;
  return row;
}
