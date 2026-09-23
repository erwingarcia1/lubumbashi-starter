import { asc, eq, sql } from "drizzle-orm";

import { findDuplicates } from "@/lib/census/duplicates";
import { loadRules, registerTaxpayer, type RegistrationResult } from "@/lib/census/register";
import { censusInput, type CensusInput } from "@/lib/census/schema";
import type { Db } from "@/lib/db/client";
import { categories, taxpayers } from "@/lib/db/schema";
import { versionFor } from "@/lib/tax-engine/rules";
import { monthPeriod } from "@/lib/time";
import { canEditTaxpayer } from "@/lib/identity/roles";
import type { AdminSession } from "@/lib/identity/session";

import type { RequestContext } from "./context";
import { AdminError } from "./errors";

export interface RegistrationCategory {
  code: string;
  labelFr: string;
  /** The rule version the engine will apply this period is a percentage of the tax base. */
  needsTaxBase: boolean;
}

/**
 * The categories of the registration form, with whether a tax base must be captured: decided
 * by the same version picker as the engine (`versionFor`) for the registration period, so a
 * percentage version approved for a later date does not demand a base today.
 */
export async function categoriesForRegistration(
  db: Db,
  now = new Date(),
): Promise<RegistrationCategory[]> {
  const rows = await db
    .select({ id: categories.id, code: categories.code, labelFr: categories.labelFr })
    .from(categories)
    .orderBy(asc(categories.sortOrder));
  const periodStart = monthPeriod(now).start;
  const rules = await loadRules(db);
  const needing = new Set(
    rules
      .filter((r) => r.active && versionFor(r, periodStart)?.calcKind === "percent_of_base")
      .map((r) => r.categoryId),
  );
  return rows.map((c) => ({ code: c.code, labelFr: c.labelFr, needsTaxBase: needing.has(c.id) }));
}

/**
 * Registers a taxpayer from the Mairie dashboard (Superviseur, Administrateur). The record goes
 * through the same service as the field census — municipal ID, first entity, obligations,
 * welcome SMS, one audit row — with the Mairie user as the actor: the position is hand-placed
 * (the office has no device GPS), WHERE = request IP, DEVICE = user agent. A phone number
 * already on file for an active taxpayer is refused (`duplicate_phone`, detail = its number);
 * the same `clientUuid` sent twice returns the taxpayer created the first time.
 */
export async function registerFromBackOffice(
  db: Db,
  session: AdminSession,
  raw: CensusInput,
  ctx: RequestContext = {},
  now = new Date(),
): Promise<RegistrationResult> {
  if (!canEditTaxpayer(session.role)) throw new AdminError("forbidden");
  const parsed = censusInput.parse(raw);
  const input: CensusInput = {
    ...parsed,
    entity: {
      ...parsed.entity,
      gps: { lng: parsed.entity.gps.lng, lat: parsed.entity.gps.lat, source: "manual" },
    },
  };
  // One transaction serialised on the phone number: two clerks submitting the same number at
  // the same time cannot both pass the duplicate check (no unique index on phone: agents may
  // share a number, D8 pending).
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as Db;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.taxpayer.phone}))`);
    const [already] = await tx
      .select({ id: taxpayers.id })
      .from(taxpayers)
      .where(eq(taxpayers.clientUuid, input.clientUuid));
    if (!already) {
      const samePhone = (await findDuplicates(scoped, { phone: input.taxpayer.phone })).find(
        (d) => d.reason === "same_phone",
      );
      if (samePhone) throw new AdminError("duplicate_phone", samePhone.taxpayerNo);
      const category = (await categoriesForRegistration(scoped, now)).find(
        (c) => c.code === input.entity.categoryCode,
      );
      if (category?.needsTaxBase && input.entity.taxBaseFc === undefined)
        throw new AdminError("invalid_input", "tax base required");
    }
    return registerTaxpayer(scoped, { type: "admin", session }, input, now, ctx);
  });
}
