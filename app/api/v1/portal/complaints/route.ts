import { fail, ok, parseBody, requestContext } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { ComplaintError, complaintInput, fileComplaint } from "@/lib/portal/complaints";
import { getPortalTaxpayer } from "@/lib/portal/session";

export async function POST(request: Request) {
  const taxpayer = await getPortalTaxpayer();
  if (!taxpayer) return fail("unauthenticated", 401);
  const parsed = await parseBody(request, complaintInput);
  if ("error" in parsed) return parsed.error;
  try {
    const row = await fileComplaint(getDb(), taxpayer, parsed.data, requestContext(request));
    return ok(row, { status: 201 });
  } catch (err) {
    if (err instanceof ComplaintError) return fail(err.code, 422);
    throw err;
  }
}
