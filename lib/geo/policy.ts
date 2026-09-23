/**
 * What happens when an agent tries to collect without a device position: refused in production,
 * accepted elsewhere (laptops during acceptance testing, phones indoors on the demo server).
 */
// DECISION-PENDING: D37 — what happens without a position.
export function positionRequiredForCollection(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.APP_ENV === "production";
}
