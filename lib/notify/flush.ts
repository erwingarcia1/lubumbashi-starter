import { after } from "next/server";

import { getDb } from "@/lib/db/client";

import { processNotificationQueue } from "./index";

/**
 * Sends what is queued once the current response is out. Until pg-boss (M9) owns the outbox,
 * this keeps the demo honest: the receipt SMS shows up seconds after the confirmation.
 */
export function flushNotificationsSoon(): void {
  after(async () => {
    try {
      await processNotificationQueue(getDb());
    } catch (err) {
      console.error("notifications: flush failed", err);
    }
  });
}
