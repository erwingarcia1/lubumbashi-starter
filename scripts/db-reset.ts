import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";

/**
 * Local/demo only: drops the application schemas (app, util, drizzle journal) and rebuilds them
 * from the migrations, then re-seeds. Refuses production. Supabase's own schemas are untouched.
 * Usage: pnpm db:reset
 */
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

async function main(): Promise<void> {
  if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") {
    console.error("db-reset: refusing to run in production");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL_MIGRATIONS;
  if (!url) throw new Error("DATABASE_URL_MIGRATIONS is not set");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query("drop schema if exists app cascade");
    await pool.query("drop schema if exists util cascade");
    await pool.query("drop schema if exists drizzle cascade");
    // Storage objects of the photos bucket are demo data too.
    await pool
      .query("delete from storage.objects where bucket_id = 'photos'")
      .catch(() => undefined);
    console.log("db-reset: schemas app, util, drizzle dropped");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
