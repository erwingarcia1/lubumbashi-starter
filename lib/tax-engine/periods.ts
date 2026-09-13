import { monthPeriodOf, type Period } from "@/lib/time";

import type { Frequency } from "./types";

export interface YearMonth {
  year: number;
  month: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** All periods of `frequency` from the one containing `from` to the one containing `to`. */
export function periodsBetween(frequency: Frequency, from: YearMonth, to: YearMonth): Period[] {
  if (from.year > to.year || (from.year === to.year && from.month > to.month)) return [];
  const out: Period[] = [];
  if (frequency === "monthly") {
    let { year, month } = from;
    while (year < to.year || (year === to.year && month <= to.month)) {
      out.push(monthPeriodOf(year, month));
      if (month === 12) {
        year += 1;
        month = 1;
      } else month += 1;
    }
    return out;
  }
  if (frequency === "quarterly") {
    let year = from.year;
    let q = Math.floor((from.month - 1) / 3);
    const lastYear = to.year;
    const lastQ = Math.floor((to.month - 1) / 3);
    while (year < lastYear || (year === lastYear && q <= lastQ)) {
      const startMonth = q * 3 + 1;
      const end = monthPeriodOf(year, startMonth + 2).end;
      out.push({ start: `${year}-${pad(startMonth)}-01`, end, dueDate: end });
      if (q === 3) {
        year += 1;
        q = 0;
      } else q += 1;
    }
    return out;
  }
  for (let year = from.year; year <= to.year; year++) {
    out.push({ start: `${year}-01-01`, end: `${year}-12-31`, dueDate: `${year}-12-31` });
  }
  return out;
}

/** Due date of a period: its last day, or `dueDay` of its last month (clamped to that month). */
export function dueDateFor(period: Period, dueDay: number | null): string {
  if (dueDay === null) return period.end;
  const [y, m, lastDay] = period.end.split("-").map(Number) as [number, number, number];
  return `${y}-${pad(m)}-${pad(Math.min(dueDay, lastDay))}`;
}
