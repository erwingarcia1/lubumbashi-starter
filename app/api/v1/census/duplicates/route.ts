import { fail, ok, parseBody } from "@/lib/api/respond";
import { findDuplicates } from "@/lib/census/duplicates";
import { duplicateQuery } from "@/lib/census/schema";
import { getDb } from "@/lib/db/client";
import { getAgentSession } from "@/lib/identity/agent-session";

export async function POST(request: Request) {
  if (!(await getAgentSession())) return fail("unauthenticated", 401);
  const body = await parseBody(request, duplicateQuery);
  if ("error" in body) return body.error;
  return ok(await findDuplicates(getDb(), body.data));
}
