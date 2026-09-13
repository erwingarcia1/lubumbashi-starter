import { cookies } from "next/headers";

import { ok } from "@/lib/api/respond";
import { AGENT_COOKIE } from "@/lib/identity/agent-session";

export async function POST() {
  const store = await cookies();
  store.delete(AGENT_COOKIE);
  return ok({ loggedOut: true });
}
