import { z } from "zod";

import { AdminError } from "@/lib/admin/errors";
import { fail, requestContext } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { canIssueInvoice } from "@/lib/identity/roles";
import { getAdminSession } from "@/lib/identity/session";
import { issueInvoicesPdf, singleTaxpayerOf } from "@/lib/invoices/issue";

export const runtime = "nodejs";

/** `?obligations=<uuid>,<uuid>`: one to two hundred obligation ids, comma-separated. */
const querySchema = z.object({
  obligations: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    )
    .pipe(z.array(z.uuid()).min(1).max(200)),
});

const STATUS: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  invalid_state: 422,
  invalid_input: 422,
};

/**
 * The notes de perception of a chosen set of obligations as ONE inline PDF (a page per note), for
 * the Mairie only: the « Notes de perception » screen and the taxpayer page's « Générer la note de
 * perception » button call it. THE FIRST SUCCESSFUL GET ISSUES every unissued note of the set: the
 * PDF is rendered first, then `obligations.invoice_issued_at/_by` is stamped and one
 * `invoice.issued` row per note written to the audit log (WHO, IP, user agent); a render failure
 * leaves the notes unissued. Later GETs re-print without a new stamp (D35). Settled, waived or
 * cancelled obligations are left out; an unknown id is 404; a set with nothing open is 422. Roles
 * that cannot issue (Auditeur) get 403 before anything is read.
 */
export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) return fail("unauthenticated", 401);
  if (!canIssueInvoice(session.role)) return fail("forbidden", 403);
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ obligations: url.searchParams.get("obligations") ?? "" });
  if (!parsed.success) return fail("invalid_input", 422, parsed.error.issues);
  let issued;
  try {
    issued = await issueInvoicesPdf(
      getDb(),
      session,
      parsed.data.obligations,
      requestContext(request),
    );
  } catch (err) {
    if (err instanceof AdminError) return fail(err.code, STATUS[err.code] ?? 400);
    throw err;
  }
  const taxpayerNo = singleTaxpayerOf(issued.snapshots);
  const filename = taxpayerNo ? `notes-${taxpayerNo}.pdf` : "notes-de-perception.pdf";
  return new Response(new Uint8Array(issued.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
