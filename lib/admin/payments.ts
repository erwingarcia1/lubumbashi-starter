import { z } from "zod";

import type { Db } from "@/lib/db/client";
import type { AdminSession } from "@/lib/identity/session";
import { PaymentError, reversePayment } from "@/lib/payments/service";

import type { RequestContext } from "./context";
import { AdminError } from "./errors";

const input = z.object({
  reference: z.string().regex(/^TX-\d{4}-\d{2}-\d{4}-[A-Z2-9]{4}$/),
  reason: z.string().trim().min(5).max(500),
});

/** Finances or Administrateur asks the provider to reverse a confirmed payment, with a reason. */
export async function requestPaymentReversal(
  db: Db,
  session: AdminSession,
  raw: { reference: string; reason: string },
  ctx: RequestContext = {},
) {
  // DECISION-PENDING: D29 — a second approver for reversals is not enforced yet.
  if (session.role !== "finances" && session.role !== "administrateur")
    throw new AdminError("forbidden");
  const { reference, reason } = input.parse(raw);
  try {
    return await reversePayment(db, reference, {
      reason,
      actor: { id: session.adminId, role: session.role, label: session.email },
      ctx,
    });
  } catch (err) {
    if (err instanceof PaymentError) {
      if (err.code === "payment_not_found") throw new AdminError("not_found", reference);
      if (err.code === "reversal_refused") throw new AdminError("provider_error", reference);
      throw new AdminError("invalid_state", err.message);
    }
    throw err;
  }
}
