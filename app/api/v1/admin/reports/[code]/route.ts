import { z } from "zod";

import { actorOf, deviceOf, whereOf } from "@/lib/admin/context";
import { AdminError } from "@/lib/admin/errors";
import { fail, requestContext } from "@/lib/api/respond";
import { writeAudit } from "@/lib/audit/write";
import { getDb } from "@/lib/db/client";
import { canIssueInvoice } from "@/lib/identity/roles";
import { getAdminSession } from "@/lib/identity/session";
import { buildReport, REPORT_CODES, reportParams, type ReportCode } from "@/lib/reports";

/**
 * Streams one of the reports; every export is itself an audited action (WHO, WHAT, IP).
 * The print run of the notes de perception ("invoices") issues the notes it prints, so it is
 * gated like the single note (`canIssueInvoice`) and built in the caller's name.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const session = await getAdminSession();
  if (!session) return fail("unauthenticated", 401);
  const { code } = await params;
  if (!(REPORT_CODES as readonly string[]).includes(code)) return fail("not_found", 404);
  const url = new URL(request.url);
  const parsed = reportParams.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return fail("invalid_input", 422, parsed.error.issues);
  if (code === "audit" && !["auditeur", "administrateur", "maire"].includes(session.role))
    return fail("forbidden", 403);
  if (code === "invoices" && !canIssueInvoice(session.role)) return fail("forbidden", 403);
  const db = getDb();
  const ctx = requestContext(request);
  let file;
  try {
    file = await buildReport(db, code as ReportCode, parsed.data, new Date(), { session, ctx });
  } catch (err) {
    if (err instanceof z.ZodError) return fail("invalid_input", 422);
    if (err instanceof AdminError && err.code === "forbidden") return fail("forbidden", 403);
    throw err;
  }
  await writeAudit(db, {
    actor: actorOf(session),
    action: "report.exported",
    object: { type: "report", id: `${code}/${parsed.data.format}` },
    details: { params: parsed.data, rows: file.rows, filename: file.filename },
    where: whereOf(ctx),
    device: deviceOf(ctx),
  });
  return new Response(new Uint8Array(file.body), {
    headers: {
      "content-type": file.contentType,
      "content-disposition": `attachment; filename="${file.filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
