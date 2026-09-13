import { z } from "zod";

import { fail, ok } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { nightlyReconciliation, previousBusinessDate } from "@/lib/jobs";

/** Runs the reconciliation for a day (default: yesterday). `Authorization: Bearer $CRON_SECRET`. */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return fail("unauthorized", 401);
  const day = new URL(request.url).searchParams.get("day") ?? previousBusinessDate();
  if (
    !z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .safeParse(day).success
  )
    return fail("invalid_input", 422);
  return ok(await nightlyReconciliation(getDb(), day));
}
