import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { appDb } from "./db";

async function bool(query: ReturnType<typeof sql>): Promise<boolean> {
  const res = await appDb().execute<{ ok: boolean }>(query);
  return Boolean(res.rows[0]?.ok);
}

describe("schema app is invisible to Supabase's API roles and sealed for the runtime role", () => {
  it("anon, authenticated and service_role have no USAGE on schema app", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(
        await bool(sql`select has_schema_privilege(${role}, 'app', 'USAGE') as ok`),
        role,
      ).toBe(false);
    }
  });

  it("app_login can use the schema but cannot create in it", async () => {
    expect(await bool(sql`select has_schema_privilege('app_login', 'app', 'USAGE') as ok`)).toBe(
      true,
    );
    expect(await bool(sql`select has_schema_privilege('app_login', 'app', 'CREATE') as ok`)).toBe(
      false,
    );
  });

  it("app_login can read and insert every app table, but not delete audit rows, confirmations or receipts", async () => {
    const tables = await appDb().execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'app' and table_type = 'BASE TABLE' order by 1`,
    );
    expect(tables.rows.length).toBeGreaterThan(25);
    for (const { table_name } of tables.rows) {
      const q = `app.${table_name}`;
      expect(
        await bool(sql`select has_table_privilege('app_login', ${q}, 'SELECT') as ok`),
        q,
      ).toBe(true);
      expect(
        await bool(sql`select has_table_privilege('app_login', ${q}, 'INSERT') as ok`),
        q,
      ).toBe(true);
    }
    for (const sealed of ["app.audit_log", "app.provider_confirmations", "app.receipts"]) {
      expect(
        await bool(sql`select has_table_privilege('app_login', ${sealed}, 'DELETE') as ok`),
        sealed,
      ).toBe(false);
      expect(
        await bool(sql`select has_table_privilege('app_login', ${sealed}, 'TRUNCATE') as ok`),
        sealed,
      ).toBe(false);
    }
    expect(
      await bool(sql`select has_table_privilege('app_login', 'app.audit_log', 'UPDATE') as ok`),
    ).toBe(false);
  });
});
