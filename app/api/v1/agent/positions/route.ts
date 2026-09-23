import { fail, ok, parseBody } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { getAgentSession } from "@/lib/identity/agent-session";
import { limits } from "@/lib/security/rate-limit";
import { ingestPositions, positionsInput } from "@/lib/tracking/ingest";

/**
 * Position pings of the logged-in agent's device (D38): up to 50 fixes per request; fixes
 * outside 06:00–20:00 Africa/Lubumbashi or older than 24 h are ignored, never refused.
 */
export async function POST(request: Request) {
  const session = await getAgentSession();
  if (!session) return fail("unauthenticated", 401);
  const verdict = limits.agentPositions.check(session.agentId);
  if (!verdict.ok)
    return fail("too_many_requests", 429, { retryAfterSeconds: verdict.retryAfterSeconds });
  const parsed = await parseBody(request, positionsInput);
  if ("error" in parsed) return parsed.error;
  const result = await ingestPositions(
    getDb(),
    { agentId: session.agentId, deviceId: session.deviceId },
    parsed.data,
  );
  return ok(result);
}
