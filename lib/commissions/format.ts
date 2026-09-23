import { formatFC } from "@/lib/i18n/format";

/** Commission totals can be negative (a month of reversals): the one formatter, with a sign. */
export function formatSignedFC(amount: number): string {
  return amount < 0 ? `−${formatFC(-amount)}` : formatFC(amount);
}

/** Basis points as a French percentage: 500 → "5 %", 525 → "5,25 %". */
export function formatRateBp(rateBp: number): string {
  const pct = rateBp / 100;
  const text = Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0+$/, "");
  return `${text.replace(".", ",")} %`;
}
