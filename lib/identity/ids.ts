import { sql } from "drizzle-orm";

import type { Tx } from "@/lib/db/client";
import { businessYear, yymm } from "@/lib/time";

const TAXPAYER_ID_RE = /^LUB-([A-Z]{3})-(\d{8})$/;

export function formatTaxpayerId(communeCode: string, n: number): string {
  if (!/^[A-Z]{3}$/.test(communeCode)) throw new TypeError(`bad commune code: ${communeCode}`);
  if (!Number.isInteger(n) || n < 1 || n > 99_999_999) throw new RangeError(`bad sequence: ${n}`);
  return `LUB-${communeCode}-${String(n).padStart(8, "0")}`;
}

export function parseTaxpayerId(id: string): { communeCode: string; n: number } | null {
  const m = TAXPAYER_ID_RE.exec(id);
  if (!m) return null;
  return { communeCode: m[1]!, n: Number(m[2]) };
}

/**
 * Next taxpayer number for a commune, gapless: the counter row is locked by the UPDATE inside
 * the caller's transaction, so a rollback returns the number to the pool.
 */
export async function allocateTaxpayerId(tx: Tx, communeCode: string): Promise<string> {
  const rows = await tx.execute<{ last: number }>(sql`
    insert into app.id_counters (commune_code, last) values (${communeCode}, 1)
    on conflict (commune_code) do update set last = app.id_counters.last + 1
    returning last
  `);
  const last = Number(rows.rows[0]?.last);
  return formatTaxpayerId(communeCode, last);
}

export function formatReceiptNo(at: Date, n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999_999) throw new RangeError(`bad sequence: ${n}`);
  return `RCP-${yymm(at)}-${String(n).padStart(6, "0")}`;
}

/**
 * Next receipt number, gapless within the business year (the month in the prefix is
 * informational). Same locking rule as allocateTaxpayerId.
 */
// DECISION-PENDING: D21 — per-year counter until the Mairie decides.
export async function allocateReceiptNo(tx: Tx, at: Date): Promise<string> {
  const year = businessYear(at);
  const rows = await tx.execute<{ last: number }>(sql`
    insert into app.receipt_counters (year, last) values (${year}, 1)
    on conflict (year) do update set last = app.receipt_counters.last + 1
    returning last
  `);
  return formatReceiptNo(at, Number(rows.rows[0]?.last));
}
