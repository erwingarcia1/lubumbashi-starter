import { fail, ok, parseBody } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { getAgentSession } from "@/lib/identity/agent-session";
import { PaymentConfigError } from "@/lib/payments/registry";
import { PaymentError, initiateInput, initiatePayment } from "@/lib/payments/service";
import { z } from "zod";

const body = initiateInput.extend({
  gps: z.object({ lng: z.number(), lat: z.number() }).optional(),
});

/** Agent surface: initiate only (invariant 2). Confirmation comes from the provider. */
export async function POST(request: Request) {
  const session = await getAgentSession();
  if (!session) return fail("unauthenticated", 401);
  const parsed = await parseBody(request, body);
  if ("error" in parsed) return parsed.error;
  try {
    const { gps, ...input } = parsed.data;
    const view = await initiatePayment(
      getDb(),
      {
        type: "agent",
        agentId: session.agentId,
        matricule: session.matricule,
        deviceId: session.deviceId,
        gps,
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
