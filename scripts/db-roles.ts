import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";

/**
 * Creates or updates the runtime login role `app_login` (member of the `app_rw` group created by
 * migration 0001) with APP_DB_PASSWORD. Idempotent. Runs as the owner (DATABASE_URL_MIGRATIONS).
 * The password never lives in a migration file.
 */
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_MIGRATIONS;
  const password = process.env.APP_DB_PASSWORD;
  if (!url || !password) {
    console.error(
      "db-roles: DATABASE_URL_MIGRATIONS and APP_DB_PASSWORD are required (see .env.example)",
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    const literal = client.escapeLiteral(password);
    const exists = await client.query("select 1 from pg_roles where rolname = 'app_login'");
    if (exists.rowCount === 0) {
      await client.query(`create role app_login login password ${literal} in role app_rw`);
    } else {
      await client.query(`alter role app_login with login password ${literal}`);
      await client.query("grant app_rw to app_login");
    }
    await client.query("alter role app_login set search_path = app, public, extensions");
    console.log("db-roles: app_login ready (member of app_rw, search_path app,public,extensions)");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
