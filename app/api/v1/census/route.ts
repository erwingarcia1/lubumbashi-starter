import { fail, ok, parseBody, requestContext } from "@/lib/api/respond";
import { CensusError, registerTaxpayer } from "@/lib/census/register";
import { censusInput } from "@/lib/census/schema";
import { getDb } from "@/lib/db/client";
import { getAgentSession } from "@/lib/identity/agent-session";
import { flushNotificationsSoon } from "@/lib/notify/flush";

/** Idempotent on clientUuid: the same record twice returns the same taxpayer (M8 sync). */
export async function POST(request: Request) {
  const session = await getAgentSession();
  if (!session) return fail("unauthenticated", 401);
  const body = await parseBody(request, censusInput);
  if ("error" in body) return body.error;
  try {
    const result = await registerTaxpayer(
      getDb(),
      session,
      body.data,
      new Date(),
      requestContext(request),
    );
    if (result.created) flushNotificationsSoon();
    return ok(result, { status: result.created ? 201 : 200 });
  } catch (err) {
    if (err instanceof CensusError) return fail(err.code, 422);
    throw err;
  }
}
