import { fail, ok } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { processNotificationQueue } from "@/lib/notify";

/** Sends the queued SMS. Called by the scheduler with `Authorization: Bearer $CRON_SECRET`. */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return fail("unauthorized", 401);
  const result = await processNotificationQueue(getDb());
  return ok(result);
}
