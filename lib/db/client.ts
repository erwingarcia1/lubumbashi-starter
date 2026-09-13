import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema> & { $client: Pool };
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

let db: Db | undefined;

function connect(connectionString: string): Db {
  const pool = new Pool({ connectionString, max: 10 });
  return drizzle({ client: pool, schema, casing: "snake_case" });
}

/**
 * Lazy singleton on DATABASE_URL, the runtime role (`app_login`): no UPDATE/DELETE/TRUNCATE on
 * audit_log, no DDL. Nothing connects at import or build time.
 */
export function getDb(): Db {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set; see .env.example");
    db = connect(url);
  }
  return db;
}

/**
 * Owner connection (DATABASE_URL_MIGRATIONS) for migrations, role management and the tests
 * that prove the audit trigger blocks the owner too. Never used by request handlers.
 */
export function createOwnerDb(): Db {
  const url = process.env.DATABASE_URL_MIGRATIONS;
  if (!url) throw new Error("DATABASE_URL_MIGRATIONS is not set; see .env.example");
  return connect(url);
}

/** A separate pool on an explicit connection string (tests, scripts). */
export function createDb(connectionString: string): Db {
  return connect(connectionString);
}
