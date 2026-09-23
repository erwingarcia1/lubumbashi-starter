import { businessDate, monthPeriodOf } from "@/lib/time";

/** Commission statements are monthly: `YYYY-MM` in business time (Africa/Lubumbashi). */
export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isPeriod(value: unknown): value is string {
  return typeof value === "string" && PERIOD_RE.test(value);
}

/** Period containing `at`. */
export function periodOf(at: Date): string {
  return businessDate(at).slice(0, 7);
}

/** Period of a business day (`YYYY-MM-DD`). */
export function periodOfDate(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** First and last business day of a period, inclusive. */
export function periodRange(period: string): { start: string; end: string } {
  if (!isPeriod(period)) throw new Error(`invalid period: ${period}`);
  const [y, m] = period.split("-").map(Number) as [number, number];
  const p = monthPeriodOf(y, m);
  return { start: p.start, end: p.end };
}

export function previousPeriod(period: string): string {
  if (!isPeriod(period)) throw new Error(`invalid period: ${period}`);
  const [y, m] = period.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
