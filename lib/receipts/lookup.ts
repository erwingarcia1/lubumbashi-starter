import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import { receipts } from "@/lib/db/schema";

import type { ReceiptSnapshot } from "./issue";

export function verifyUrlFor(
  receiptNo: string,
  token: string,
  appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "",
): string {
  return `${appUrl.replace(/\/$/, "")}/v/${receiptNo}/${token}`;
}

/** Public lookup: number + token must both match (numbers are sequential, tokens are random). */
export async function findReceipt(db: Db, receiptNo: string, token?: string) {
  const [r] = await db.select().from(receipts).where(eq(receipts.receiptNo, receiptNo));
  if (!r) return null;
  if (token !== undefined && token !== r.verifyToken) return null;
  return { ...r, snapshot: r.snapshot as ReceiptSnapshot };
}
