import { z } from "zod";

import { AdminError } from "@/lib/admin/errors";
import { fail, requestContext } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { canIssueInvoice } from "@/lib/identity/roles";
import { getAdminSession } from "@/lib/identity/session";
import { issueInvoicePdf } from "@/lib/invoices/issue";

export const runtime = "nodejs";

const invoiceNoParam = z.string().regex(/^AV-\d{4}-\d{6}$/);

const STATUS: Record<string, number> = { not_found: 404, forbidden: 403, invalid_state: 409 };

/**
 * The note de perception of one obligation, as an inline PDF, for the Mairie only.
 * THE FIRST SUCCESSFUL GET ISSUES THE NOTE: the PDF is rendered first, then
 * `obligations.invoice_issued_at/_by` is stamped and `invoice.issued` written to the audit log
 * (WHO, IP, user agent); a render failure leaves the note unissued. Later GETs re-print the same
 * note: same number, first issue date kept, amounts as of the print date (D35). Roles that
 * cannot issue (Maire, Auditeur) get 403 before anything is read or stamped.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ invoiceNo: string }> },
) {
  const session = await getAdminSession();
  if (!session) return fail("unauthenticated", 401);
  if (!canIssueInvoice(session.role)) return fail("forbidden", 403);
  const parsed = invoiceNoParam.safeParse((await params).invoiceNo);
  if (!parsed.success) return fail("not_found", 404);
  let issued;
  try {
    issued = await issueInvoicePdf(
      getDb(),
      session,
      { invoiceNo: parsed.data },
      requestContext(request),
    );
  } catch (err) {
    if (err instanceof AdminError) return fail(err.code, STATUS[err.code] ?? 400);
    throw err;
  }
  return new Response(new Uint8Array(issued.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${parsed.data}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
