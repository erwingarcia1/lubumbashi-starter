import { fail, ok } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { flushNotificationsSoon } from "@/lib/notify/flush";
import { PaymentConfigError } from "@/lib/payments/registry";
import { PaymentError, syncPaymentStatus } from "@/lib/payments/service";
import { findInvoice } from "@/lib/portal/invoice";
import { getPortalTaxpayer } from "@/lib/portal/session";

/** Polled by the portal wait screen; only the paying taxpayer may read the attempt. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;
  const db = getDb();
  const url = new URL(request.url);
  let taxpayerNo = (await getPortalTaxpayer())?.taxpayerNo ?? null;
  if (!taxpayerNo) {
    const invoiceNo = url.searchParams.get("invoiceNo");
    const token = url.searchParams.get("token");
    if (invoiceNo && token) {
      const inv = await findInvoice(db, invoiceNo, token);
      taxpayerNo = inv?.taxpayer.taxpayerNo ?? null;
    }
  }
  if (!taxpayerNo) return fail("unauthenticated", 401);
  try {
    const view = await syncPaymentStatus(db, reference);
    if (!view || view.taxpayerNo !== taxpayerNo) return fail("not_found", 404);
    if (view.status === "confirmed") flushNotificationsSoon();
    return ok(view);
  } catch (err) {
    if (err instanceof PaymentError) return fail(err.code, 422);
    if (err instanceof PaymentConfigError) return fail(err.code, 503);
    throw err;
  }
}
