import { fail, ok } from "@/lib/api/respond";
import { listTaxpayers } from "@/lib/admin/taxpayers";
import { getDb } from "@/lib/db/client";
import { getAgentSession } from "@/lib/identity/agent-session";

/** Name, phone or ID search for the agent's scan fallback; phone numbers are returned masked. */
export async function GET(request: Request) {
  if (!(await getAgentSession())) return fail("unauthenticated", 401);
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 3) return ok([]);
  const { items } = await listTaxpayers(getDb(), { q, pageSize: 10 });
  // DECISION-PENDING: D18 — agents see a masked phone in lists.
  return ok(
    items.map((i) => ({
      taxpayerNo: i.taxpayerNo,
      fullName: i.fullName,
      phoneMasked: i.phone.replace(/^(\+\d{5})\d+(\d{4})$/, "$1 ••• $2"),
      pill: i.balance.pill,
      outstandingFc: i.balance.outstandingFc,
    })),
  );
}
