/**
 * The one rounding rule for money (invariant 9: integers only).
 * Half up to the nearest franc, for non-negative values.
 */
// DECISION-PENDING: D22 — rounding to the franc; the Mairie may prefer 50 or 100 FC.
export function roundFc(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`roundFc: expected a non-negative finite number, got ${value}`);
  }
  return Math.floor(value + 0.5);
}

/** value × rate in basis points, rounded. 10 000 bp = 100 %. */
export function applyBp(valueFc: number, rateBp: number): number {
  return roundFc((valueFc * rateBp) / 10_000);
}
