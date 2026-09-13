import { createDb, createOwnerDb, type Db } from "@/lib/db/client";

let app: Db | undefined;
let owner: Db | undefined;

/** Runtime role (app_login). */
export function appDb(): Db {
  app ??= createDb(process.env.DATABASE_URL!);
  return app;
}

/** Owner role (postgres): for the tests that prove triggers block the owner too. */
export function ownerDb(): Db {
  owner ??= createOwnerDb();
  return owner;
}

/** Postgres SQLSTATE of a thrown error, whether Drizzle wrapped it or not. */
export function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.code;
}

export function pgMessage(err: unknown): string {
  const e = err as { message?: string; cause?: { message?: string } };
  return e?.cause?.message ?? e?.message ?? String(err);
}

/** Runs `fn` in a transaction that is always rolled back; returns what `fn` returned. */
export async function rolledBack<T>(
  db: Db,
  fn: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  const marker = new Error("rollback");
  try {
    await db.transaction(async (tx) => {
      result = await fn(tx);
      throw marker;
    });
  } catch (err) {
    if (err !== marker) throw err;
  }
  return result as T;
}
