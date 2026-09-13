import { z } from "zod";

import { fail, ok, parseBody } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { flushNotificationsSoon } from "@/lib/notify/flush";
import { applyProviderResult, PaymentError } from "@/lib/payments/service";

const callback = z.object({
  reference: z.string().min(1),
  status: z.enum(["confirmed", "failed"]),
  providerReference: z.string().min(1),
  amountFc: z.number().int().positive(),
  failureReason: z.string().optional(),
});

/**
 * Simulated provider callback (tests and demos): idempotent on (provider, providerReference).
 * Refused in production like the mock provider itself (invariant 1).
 */
export async function POST(request: Request) {
  if (process.env.APP_ENV === "production") return fail("mock_disabled_in_production", 403);
  const body = await parseBody(request, callback);
  if ("error" in body) return body.error;
  const c = body.data;
  try {
    const result =
      c.status === "confirmed"
        ? await applyProviderResult(
            getDb(),
            c.reference,
            {
              status: "confirmed",
              providerReference: c.providerReference,
              amountFc: c.amountFc,
              raw: c,
            },
            "callback",
          )
        : await applyProviderResult(
            getDb(),
            c.reference,
            { status: "failed", failureReason: c.failureReason ?? "Refusé", raw: c },
            "callback",
          );
    if (result.applied && result.status === "confirmed") flushNotificationsSoon();
    return ok(result);
  } catch (err) {
    if (err instanceof PaymentError)
      return fail(err.code, err.code === "payment_not_found" ? 404 : 409);
    throw err;
  }
}
