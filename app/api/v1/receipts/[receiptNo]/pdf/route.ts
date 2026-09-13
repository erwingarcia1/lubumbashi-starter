import { getDb } from "@/lib/db/client";
import { getAgentSession } from "@/lib/identity/agent-session";
import { getAdminSession } from "@/lib/identity/session";
import { findReceipt, verifyUrlFor } from "@/lib/receipts/lookup";
import { renderReceiptPdf } from "@/lib/receipts/pdf";

export const runtime = "nodejs";

/** The receipt as PDF: with the verification token (public link), or for a logged-in agent/admin. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ receiptNo: string }> },
) {
  const { receiptNo } = await params;
  const token = new URL(request.url).searchParams.get("token") ?? undefined;
  const db = getDb();
  let receipt = token ? await findReceipt(db, receiptNo, token) : null;
  if (!receipt) {
    const authorised = (await getAgentSession()) ?? (await getAdminSession());
    if (!authorised) return new Response("Unauthorized", { status: 401 });
    receipt = await findReceipt(db, receiptNo);
  }
  if (!receipt) return new Response("Not found", { status: 404 });
  const pdf = await renderReceiptPdf(
    receipt.snapshot,
    verifyUrlFor(receipt.receiptNo, receipt.verifyToken),
    receipt.status,
  );
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${receipt.receiptNo}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
