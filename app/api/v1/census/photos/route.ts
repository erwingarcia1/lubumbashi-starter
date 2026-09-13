import { fail, ok, parseBody } from "@/lib/api/respond";
import { registerPhoto, registerPhotoInput } from "@/lib/census/photos";
import { getDb } from "@/lib/db/client";
import { getAgentSession } from "@/lib/identity/agent-session";

export async function POST(request: Request) {
  const session = await getAgentSession();
  if (!session) return fail("unauthenticated", 401);
  const body = await parseBody(request, registerPhotoInput);
  if ("error" in body) return body.error;
  const result = await registerPhoto(getDb(), session, body.data);
  return result ? ok(result, { status: 201 }) : fail("not_found", 404);
}
