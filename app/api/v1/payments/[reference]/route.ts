import { fail, ok } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { getAgentSession } from "@/lib/identity/agent-session";
import { PaymentConfigError } from "@/lib/payments/registry";
import { PaymentError, syncPaymentStatus } from "@/lib/payments/service";

/** Polled by the wait screen: re-queries the provider while pending, never sets anything itself. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  if (!(await getAgentSession())) return fail("unauthenticated", 401);
  const { reference } = await params;
  try {
    const view = await syncPaymentStatus(getDb(), reference);
    return view ? ok(view) : fail("not_found", 404);
  } catch (err) {
    if (err instanceof PaymentError) return fail(err.code, 422);
    if (err instanceof PaymentConfigError) return fail(err.code, 503);
    throw err;
  }
}
