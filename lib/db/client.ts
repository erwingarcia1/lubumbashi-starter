import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;

let db: Db | undefined;

/**
 * Lazy singleton: nothing connects at import or build time.
 * Uses DATABASE_URL (the runtime role). Migrations use DATABASE_URL_MIGRATIONS via drizzle.config.ts.
 */
export function getDb(): Db {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set; see .env.example");
    }
    const pool = new Pool({ connectionString, max: 10 });
    db = drizzle({ client: pool, schema, casing: "snake_case" });
  }
  return db;
}
