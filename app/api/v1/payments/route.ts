import { fail, ok, parseBody } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { guardCollectionPosition } from "@/lib/geo/collection";
import { getAgentSession } from "@/lib/identity/agent-session";
import { PaymentConfigError } from "@/lib/payments/registry";
import { PaymentError, initiateInput, initiatePayment } from "@/lib/payments/service";
import { limits } from "@/lib/security/rate-limit";
import { z } from "zod";

const body = initiateInput.extend({
  gps: z
    .object({ lng: z.number(), lat: z.number(), accuracyM: z.number().min(0).optional() })
    .optional(),
});

/** Agent surface: initiate only (invariant 2). Confirmation comes from the provider. */
export async function POST(request: Request) {
  const session = await getAgentSession();
  if (!session) return fail("unauthenticated", 401);
  const verdict = limits.agentPayments.check(session.agentId);
  if (!verdict.ok)
    return fail("too_many_requests", 429, { retryAfterSeconds: verdict.retryAfterSeconds });
  const parsed = await parseBody(request, body);
  if ("error" in parsed) return parsed.error;
  try {
    const { gps, ...input } = parsed.data;
    // Geofence (D37): outside the agent's zone the request never reaches a provider; without a
    // position it is refused in production only (lib/geo/policy.ts).
    const guard = await guardCollectionPosition(getDb(), session, input.taxpayerNo, gps);
    if (!guard.ok)
      return fail(
        guard.code,
        422,
        guard.code === "outside_zone"
          ? { distanceM: guard.distanceM, allowedM: guard.allowedM, zone: guard.zone }
          : undefined,
      );
    const view = await initiatePayment(
      getDb(),
      {
        type: "agent",
        agentId: session.agentId,
        matricule: session.matricule,
        deviceId: session.deviceId,
        gps: gps ? { lng: gps.lng, lat: gps.lat } : undefined,
      },
      input,
    );
    return ok(view, { status: 201 });
  } catch (err) {
    if (err instanceof PaymentError)
      return fail(err.code, err.code === "taxpayer_not_found" ? 404 : 422);
    if (err instanceof PaymentConfigError) return fail(err.code, 503);
    throw err;
  }
}
