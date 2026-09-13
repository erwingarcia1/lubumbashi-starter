import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

/**
 * Sends queued notifications every few seconds (console provider by default). The `ops`
 * container runs this until pg-boss (M9) takes over the outbox.
 */
async function main() {
  const { getDb } = await import("@/lib/db/client");
  const { processNotificationQueue } = await import("@/lib/notify");
  const db = getDb();
  const intervalMs = Number(process.env.NOTIFY_INTERVAL_MS ?? 5000);
  console.log(
    `notify worker: provider ${process.env.SMS_PROVIDER ?? "console"}, every ${intervalMs} ms`,
  );
  for (;;) {
    try {
      const r = await processNotificationQueue(db);
      if (r.sent || r.failed) console.log(`notify worker: sent ${r.sent}, failed ${r.failed}`);
    } catch (err) {
      console.error("notify worker:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

void main();
