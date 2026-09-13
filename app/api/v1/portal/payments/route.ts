import { z } from "zod";

import { fail, ok, parseBody, requestContext } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { PaymentConfigError } from "@/lib/payments/registry";
import { PaymentError, initiatePayment } from "@/lib/payments/service";
import { findInvoice } from "@/lib/portal/invoice";
import { getPortalTaxpayer } from "@/lib/portal/session";
import { clientKey, limits } from "@/lib/security/rate-limit";

const body = z.strictObject({
  channel: z.enum(["mpesa", "airtel", "orange", "tpe"]),
  obligationIds: z.array(z.uuid()).max(50).optional(),
  /** A scanned avis d'imposition pays exactly that obligation, without a portal session. */
  invoice: z.strictObject({ invoiceNo: z.string(), token: z.string() }).optional(),
});

/** Portal surface: the taxpayer initiates; the provider confirms (invariants 1, 2, 5). */
export async function POST(request: Request) {
  const verdict = limits.portalPayments.check(clientKey(requestContext(request).ip));
  if (!verdict.ok)
    return fail("too_many_requests", 429, { retryAfterSeconds: verdict.retryAfterSeconds });
  const parsed = await parseBody(request, body);
  if ("error" in parsed) return parsed.error;
  const { channel, invoice } = parsed.data;
  let obligationIds = parsed.data.obligationIds;
  const db = getDb();

  let taxpayer: { id: string; taxpayerNo: string } | null = await getPortalTaxpayer();
  if (!taxpayer && invoice) {
    const inv = await findInvoice(db, invoice.invoiceNo, invoice.token);
    if (!inv || inv.taxpayer.status !== "active") return fail("unauthenticated", 401);
    taxpayer = inv.taxpayer;
    obligationIds = [inv.obligation.id];
  }
  if (!taxpayer) return fail("unauthenticated", 401);

  try {
    const view = await initiatePayment(
      db,
      {
        type: "taxpayer",
        taxpayerId: taxpayer.id,
        taxpayerNo: taxpayer.taxpayerNo,
        ...requestContext(request),
      },
      { taxpayerNo: taxpayer.taxpayerNo, channel, obligationIds },
    );
    return ok(view, { status: 201 });
  } catch (err) {
    if (err instanceof PaymentError)
      return fail(err.code, err.code === "taxpayer_not_found" ? 404 : 422);
    if (err instanceof PaymentConfigError) return fail(err.code, 503);
    throw err;
  }
}
