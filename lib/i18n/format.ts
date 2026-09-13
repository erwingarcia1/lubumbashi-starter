/** No-break space (U+00A0). Never U+202F: the PDF fonts cannot draw it and SMS cost triples. */
const NBSP = " ";

/**
 * The only money formatter. Amounts are integers in Congolese francs (invariant 9).
 * formatFC(15000) → "15 000 FC" (with U+00A0).
 */
export function formatFC(amount: number): string {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new TypeError(`formatFC: amount must be a non-negative integer, got ${amount}`);
  }
  const digits = String(amount);
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${grouped}${NBSP}FC`;
}

const dateFr = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Lubumbashi",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const dateTimeFr = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Lubumbashi",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const monthFr = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Lubumbashi",
  month: "short",
  year: "numeric",
});

/** 13/09/2026 in business time; accepts a Date or an ISO date string. */
export function formatDateFr(value: Date | string): string {
  const d = typeof value === "string" ? new Date(`${value}T12:00:00+02:00`) : value;
  return dateFr.format(d);
}

/** 13/09 08:44 in business time. */
export function formatDateTimeFr(value: Date): string {
  return dateTimeFr.format(value).replace(",", "");
}

/** "sept. 2026" for a period start (ISO date). */
export function formatMonthFr(isoDate: string): string {
  return monthFr.format(new Date(`${isoDate}T12:00:00+02:00`));
}
