import { loadEnvConfig } from "@next/env";
import { PgBoss, type Job } from "pg-boss";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

/**
 * pg-boss worker (docker compose `worker` profile, or `pnpm worker` locally): nightly
 * reconciliation at 23:30, penalty accrual at 00:10, notification sends every minute, agent
 * position purge at 01:00; all in Africa/Lubumbashi. The tables live in schema `pgboss` (migration 0009).
 */
async function main() {
  const { getDb } = await import("@/lib/db/client");
  const {
    JOBS,
    accruePenalties,
    nightlyReconciliation,
    processNotificationQueue,
    purgePositions,
    refreshCurrentMonthDrafts,
    refreshPreviousMonthDrafts,
  } = await import("@/lib/jobs");
  const db = getDb();
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL!,
    schema: "pgboss",
    // The schema is created by migration 0009: app_login may create tables in it but has no CREATE
    // privilege on the database, and Postgres checks that before the IF NOT EXISTS shortcut.
    createSchema: false,
    application_name: "lubumbashi-worker",
  });
  boss.on("error", (err: Error) => console.error("pg-boss:", err));
  await boss.start();
  const tz = "Africa/Lubumbashi";

  for (const q of Object.values(JOBS)) await boss.createQueue(q);
  await boss.schedule(JOBS.reconcileDaily, "30 23 * * *", null, { tz });
  await boss.schedule(JOBS.penaltiesDaily, "10 0 * * *", null, { tz });
  await boss.schedule(JOBS.notifyFlush, "* * * * *", null, { tz });
  await boss.schedule(JOBS.positionsPurge, "0 1 * * *", null, { tz });
  // Commission drafts (D36): one queue, two keyed schedules — the month that just ended on the
  // 1st at 00:30, the month in progress every day at 00:20.
  await boss.schedule(
    JOBS.commissionsMonthly,
    "30 0 1 * *",
    { scope: "previous" },
    {
      tz,
      key: "previous-month",
    },
  );
  await boss.schedule(
    JOBS.commissionsMonthly,
    "20 0 * * *",
    { scope: "current" },
    {
      tz,
      key: "current-month",
    },
  );

  await boss.work(JOBS.reconcileDaily, async ([job]: Job<{ day?: string } | null>[]) => {
    const day = job?.data?.day;
    const runs = await nightlyReconciliation(db, day);
    for (const r of runs)
      console.log(
        `reconcile ${r.businessDate} ${r.provider}: ${r.status}, ${r.matchedCount} matched, ${r.exceptionCount} open exceptions`,
      );
  });
  await boss.work(JOBS.penaltiesDaily, async () => {
    const r = await accruePenalties(db);
    console.log(`penalties ${r.asOf}: ${r.updated} obligations, +${r.addedFc} FC`);
  });
  await boss.work(JOBS.notifyFlush, async () => {
    const r = await processNotificationQueue(db);
    if (r.sent || r.failed) console.log(`notify: sent ${r.sent}, failed ${r.failed}`);
  });
  await boss.work(JOBS.positionsPurge, async () => {
    const r = await purgePositions(db);
    console.log(`positions: purged ${r.deleted} rows before ${r.before}`);
  });
  await boss.work(
    JOBS.commissionsMonthly,
    async ([job]: Job<{ scope?: "previous" | "current" } | null>[]) => {
      const r =
        job?.data?.scope === "previous"
          ? await refreshPreviousMonthDrafts(db)
          : await refreshCurrentMonthDrafts(db);
      console.log(`commissions ${r.period}: ${r.refreshed} drafts refreshed, ${r.frozen} frozen`);
    },
  );
  console.log(`worker: ${Object.values(JOBS).join(", ")} scheduled (${tz})`);

  const stop = async () => {
    await boss.stop({ graceful: true, timeout: 10_000 });
    await db.$client.end();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
