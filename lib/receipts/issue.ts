import { randomBytes } from "node:crypto";

import type { Tx } from "@/lib/db/client";
import { receipts } from "@/lib/db/schema";
import { allocateReceiptNo } from "@/lib/identity/ids";

export interface ReceiptAllocation {
  ruleCode: string;
  ruleLabelFr: string;
  periodStart: string;
  periodEnd: string;
  kind: "principal" | "penalty";
  amountFc: number;
}

export interface ReceiptSnapshot {
  receiptNo: string;
  taxpayerNo: string;
  taxpayerName: string;
  amountFc: number;
  channel: string;
  providerReference: string;
  issuedAt: string;
  agentMatricule: string | null;
  allocations: ReceiptAllocation[];
}

/**
 * Issues the receipt of a confirmed payment inside the confirming transaction (invariant 7):
 * gapless number, random verification token, immutable snapshot of everything printed.
 */
export async function issueReceipt(
  tx: Tx,
  input: {
    paymentId: string;
    taxpayerId: string;
    taxpayerNo: string;
    taxpayerName: string;
    amountFc: number;
    channel: string;
    providerReference: string;
    agentMatricule: string | null;
    allocations: ReceiptAllocation[];
  },
  at: Date,
): Promise<{ id: string; receiptNo: string; verifyToken: string; snapshot: ReceiptSnapshot }> {
  const receiptNo = await allocateReceiptNo(tx, at);
  const verifyToken = randomBytes(16).toString("hex");
  const snapshot: ReceiptSnapshot = {
    receiptNo,
    taxpayerNo: input.taxpayerNo,
    taxpayerName: input.taxpayerName,
    amountFc: input.amountFc,
    channel: input.channel,
    providerReference: input.providerReference,
    issuedAt: at.toISOString(),
    agentMatricule: input.agentMatricule,
    allocations: input.allocations,
  };
  const [row] = await tx
    .insert(receipts)
    .values({
      receiptNo,
      paymentId: input.paymentId,
      taxpayerId: input.taxpayerId,
      amountFc: input.amountFc,
      verifyToken,
      snapshot,
      issuedAt: at,
      createdAt: at,
    })
    .returning({ id: receipts.id });
  return { id: row!.id, receiptNo, verifyToken, snapshot };
}
