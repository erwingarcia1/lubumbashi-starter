import { z } from "zod";

import { fail, ok, parseBody } from "@/lib/api/respond";
import { CensusError, previewObligations } from "@/lib/census/register";
import { getDb } from "@/lib/db/client";
import { getAgentSession } from "@/lib/identity/agent-session";

export async function POST(request: Request) {
  if (!(await getAgentSession())) return fail("unauthenticated", 401);
  const body = await parseBody(request, z.object({ categoryCode: z.string().min(1) }));
  if ("error" in body) return body.error;
  try {
    return ok(await previewObligations(getDb(), body.data.categoryCode));
  } catch (err) {
    if (err instanceof CensusError) return fail(err.code, 422);
    throw err;
  }
}
