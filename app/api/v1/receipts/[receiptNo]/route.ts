import { fail, ok } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { getAgentSession } from "@/lib/identity/agent-session";
import { findReceipt } from "@/lib/receipts/lookup";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ receiptNo: string }> },
) {
  if (!(await getAgentSession())) return fail("unauthenticated", 401);
  const { receiptNo } = await params;
  const r = await findReceipt(getDb(), receiptNo);
  if (!r) return fail("not_found", 404);
  return ok({
    receiptNo: r.receiptNo,
    status: r.status,
    issuedAt: r.snapshot.issuedAt,
    amountFc: r.amountFc,
    allocations: r.snapshot.allocations,
    verifyToken: r.verifyToken,
  });
}
