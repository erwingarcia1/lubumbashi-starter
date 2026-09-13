/**
 * Business time: everything calendar-valued (periods, due dates, day counts, the YYMM/DD/HHMM
 * parts of references, business days) is computed in Africa/Lubumbashi, never from the
 * server's local date. UTC+2, no daylight saving, so Intl alone is enough.
 */
export const BUSINESS_TZ = "Africa/Lubumbashi";

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export interface BusinessClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

export function businessClock(at: Date): BusinessClock {
  const map: Record<string, string> = {};
  for (const p of parts.formatToParts(at)) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** ISO date (YYYY-MM-DD) of the business day containing `at`. */
export function businessDate(at: Date): string {
  const c = businessClock(at);
  return `${c.year}-${pad(c.month, 2)}-${pad(c.day, 2)}`;
}

/** Two-digit year + month, as used in TX-YYMM-… and RCP-YYMM-…. */
export function yymm(at: Date): string {
  const c = businessClock(at);
  return `${pad(c.year % 100, 2)}${pad(c.month, 2)}`;
}

/** Business year (for the yearly receipt counter). */
export function businessYear(at: Date): number {
  return businessClock(at).year;
}

export interface Period {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD, inclusive
  dueDate: string; // last day of the period unless a rule says otherwise
}

/** Calendar month containing `at`, with its last day as due date. */
export function monthPeriod(at: Date): Period {
  const c = businessClock(at);
  return monthPeriodOf(c.year, c.month);
}

export function monthPeriodOf(year: number, month: number): Period {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const start = `${year}-${pad(month, 2)}-01`;
  const end = `${year}-${pad(month, 2)}-${pad(lastDay, 2)}`;
  return { start, end, dueDate: end };
}

/** Whole days between two ISO dates (b - a); negative if b is before a. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86_400_000);
}

/** Days late as of business day `asOf` for an obligation due on `dueDate` (0 if not late). */
export function daysLate(dueDate: string, asOf: string): number {
  return Math.max(0, daysBetween(dueDate, asOf));
}
