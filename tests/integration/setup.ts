import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";

// NODE_ENV=test → .env.test (+ .env.test.local): the local Supabase stack only.
loadEnvConfig(process.cwd(), true);

for (const key of ["DATABASE_URL", "DATABASE_URL_MIGRATIONS"]) {
  if (!process.env[key]) throw new Error(`integration tests: ${key} missing; see .env.test`);
}

const probe = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 3000,
});
try {
  await probe.query("select 1");
} catch (err) {
  throw new Error(
    `integration tests need the local Supabase stack: run \`supabase start\` then \`pnpm db:migrate\` (${String(err)})`,
  );
} finally {
  await probe.end();
}
