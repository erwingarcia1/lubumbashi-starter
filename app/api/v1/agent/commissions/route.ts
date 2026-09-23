import { z } from "zod";

import { fail, ok } from "@/lib/api/respond";
import { agentMonthView } from "@/lib/commissions/agent-view";
import { PERIOD_RE, periodOf } from "@/lib/commissions/period";
import { getDb } from "@/lib/db/client";
import { getAgentSession } from "@/lib/identity/agent-session";

const query = z.object({
  month: z.string().regex(PERIOD_RE).optional(),
});

/** "Mes commissions" for the PWA: the agent's own month (default: the current one). Read-only. */
export async function GET(request: Request) {
  const session = await getAgentSession();
  if (!session) return fail("unauthenticated", 401);
  const url = new URL(request.url);
  const parsed = query.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return fail("invalid_input", 422, parsed.error.issues);
  const now = new Date();
  const view = await agentMonthView(
    getDb(),
    session.agentId,
    parsed.data.month ?? periodOf(now),
    now,
  );
  return ok(view, { headers: { "cache-control": "private, no-store" } });
}
