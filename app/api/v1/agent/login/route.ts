import { cookies } from "next/headers";

import { fail, ok, parseBody, requestContext } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { AgentLoginError, agentLoginInput, loginAgent } from "@/lib/identity/agent-auth";
import { AGENT_COOKIE, AGENT_SESSION_HOURS, signAgentToken } from "@/lib/identity/agent-session";

export async function POST(request: Request) {
  const body = await parseBody(request, agentLoginInput);
  if ("error" in body) return body.error;
  try {
    const result = await loginAgent(getDb(), body.data, requestContext(request));
    const exp = Math.floor(Date.now() / 1000) + AGENT_SESSION_HOURS * 3600;
    const token = await signAgentToken({
      agentId: result.agentId,
      deviceId: result.device.id,
      exp,
    });
    const store = await cookies();
    store.set(AGENT_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: AGENT_SESSION_HOURS * 3600,
      secure: process.env.NODE_ENV === "production",
    });
    return ok(result);
  } catch (err) {
    if (err instanceof AgentLoginError) return fail(err.code, err.code === "locked" ? 423 : 401);
    throw err;
  }
}
