/**
 * Census positions placed by hand on a map, used when the device gives none (location refused,
 * indoors, a laptop during acceptance testing). The server records such points as `manual`:
 * no accuracy on the entity, `gpsSource: "manual"` in the audit row, WHERE = the request IP.
 */
// DECISION-PENDING: D34 — accepted outside production only until the Mairie decides.
export function manualPositionAllowed(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.APP_ENV !== "production";
}
