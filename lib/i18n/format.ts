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
