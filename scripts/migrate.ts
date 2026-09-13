import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * Applies drizzle/migrations with the owner connection (DATABASE_URL_MIGRATIONS). Same journal
 * table as drizzle-kit (`drizzle.__drizzle_migrations`), but usable inside a Docker image
 * without drizzle-kit, and it prints the failing statement instead of swallowing it.
 */
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_MIGRATIONS;
  if (!url) {
    console.error("migrate: DATABASE_URL_MIGRATIONS is not set; see .env.example");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: "drizzle/migrations",
      migrationsSchema: "drizzle",
      migrationsTable: "__drizzle_migrations",
    });
    const { rows } = await pool.query<{ n: string }>(
      "select count(*)::text as n from drizzle.__drizzle_migrations",
    );
    console.log(`migrate: up to date (${rows[0]?.n} migrations applied)`);
  } catch (err) {
    const e = err as { message?: string; cause?: { message?: string; position?: string } };
    console.error("migrate: FAILED:", e.cause?.message ?? e.message ?? String(err));
    if (e.cause?.position) console.error(`  at character ${e.cause.position}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
