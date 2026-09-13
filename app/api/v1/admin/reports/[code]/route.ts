import { z } from "zod";

import { fail } from "@/lib/api/respond";
import { writeAudit } from "@/lib/audit/write";
import { getDb } from "@/lib/db/client";
import { getAdminSession } from "@/lib/identity/session";
import { buildReport, REPORT_CODES, reportParams, type ReportCode } from "@/lib/reports";

/** Streams one of the six reports; every export is itself an audited action (WHO, WHAT, IP). */
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
  const db = getDb();
  let file;
  try {
    file = await buildReport(db, code as ReportCode, parsed.data);
  } catch (err) {
    if (err instanceof z.ZodError) return fail("invalid_input", 422);
    throw err;
  }
  await writeAudit(db, {
    actor: { type: "admin", id: session.adminId, role: session.role, label: session.email },
    action: "report.exported",
    object: { type: "report", id: `${code}/${parsed.data.format}` },
    details: { params: parsed.data, rows: file.rows, filename: file.filename },
    where: request.headers.get("x-forwarded-for")
      ? { ip: request.headers.get("x-forwarded-for")!.split(",")[0]!.trim() }
      : undefined,
    device: request.headers.get("user-agent")
      ? { userAgent: request.headers.get("user-agent")! }
      : undefined,
  });
  return new Response(new Uint8Array(file.body), {
    headers: {
      "content-type": file.contentType,
      "content-disposition": `attachment; filename="${file.filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
