import { fail, ok } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { accruePenalties } from "@/lib/jobs";

/** Daily penalty accrual. `Authorization: Bearer $CRON_SECRET`. */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return fail("unauthorized", 401);
  return ok(await accruePenalties(getDb()));
}
