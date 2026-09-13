import { fail, ok, parseBody } from "@/lib/api/respond";
import { getTaxpayerDetail } from "@/lib/admin/taxpayers";
import { agentContactInput, ContactError, updateContactAsAgent } from "@/lib/census/contact";
import { getDb } from "@/lib/db/client";
import { getAgentSession } from "@/lib/identity/agent-session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taxpayerNo: string }> },
) {
  if (!(await getAgentSession())) return fail("unauthenticated", 401);
  const { taxpayerNo } = await params;
  const d = await getTaxpayerDetail(getDb(), taxpayerNo);
  if (!d) return fail("not_found", 404);
  return ok({
    taxpayerNo: d.taxpayer.taxpayerNo,
    fullName: d.taxpayer.fullName,
    phone: d.taxpayer.phone,
    address: d.taxpayer.address,
    quartier: d.quartier,
    registeredAt: d.taxpayer.registeredAt,
    balance: d.balance,
    entities: d.entities.map((e) => ({
      id: e.entity.id,
      name: e.entity.name,
      categoryLabel: e.categoryLabel,
    })),
    obligations: d.obligations.map((o) => ({
      ruleLabel: o.ruleLabel,
      periodStart: o.periodStart,
      dueDate: o.dueDate,
      amountFc: o.amountFc,
      penaltyFc: o.penaltyFc,
      paidFc: o.paidFc,
      status: o.status,
    })),
    payments: d.payments.map((p) => ({
      createdAt: p.p.createdAt,
      amountFc: p.p.amountFc,
      channel: p.p.channel,
      origin: p.p.origin,
      status: p.p.status,
      receiptNo: p.receiptNo,
    })),
  });
}

/** Contact fields only (phone, address); the offline outbox replays this with its client UUID. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taxpayerNo: string }> },
) {
  const session = await getAgentSession();
  if (!session) return fail("unauthenticated", 401);
  const { taxpayerNo } = await params;
  const body = await parseBody(request, agentContactInput);
  if ("error" in body) return body.error;
  if (body.data.taxpayerNo !== taxpayerNo) return fail("invalid_input", 422);
  try {
    return ok(await updateContactAsAgent(getDb(), session, body.data));
  } catch (err) {
    if (err instanceof ContactError) return fail(err.code, err.code === "not_found" ? 404 : 422);
    throw err;
  }
}
