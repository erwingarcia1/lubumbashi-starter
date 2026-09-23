"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";

import { AdminError, type AdminErrorCode } from "@/lib/admin/errors";
import { isPeriod, periodOf } from "@/lib/commissions/period";
import { createCommissionRule } from "@/lib/commissions/rules";
import { approveStatement, markPaid, upsertDraft } from "@/lib/commissions/statements";
import { getDb } from "@/lib/db/client";
import { canManageCommissions } from "@/lib/identity/roles";
import { requireAdmin } from "@/lib/identity/session";
import { refreshDraftStatements } from "@/lib/jobs/commissions";

async function requestContext() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: forwarded || h.get("x-real-ip") || undefined,
    userAgent: h.get("user-agent") ?? undefined,
  };
}

/** Maps a failed core call to an error code for the page banner; anything unexpected is rethrown. */
function codeOf(err: unknown): AdminErrorCode {
  if (err instanceof AdminError) return err.code;
  if (err instanceof ZodError) return "invalid_input";
  throw err;
}

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const periodOfForm = (formData: FormData) => {
  const p = str(formData, "period");
  return isPeriod(p) ? p : periodOf(new Date());
};

/** A unique `t` makes every redirect a real navigation, so the page never shows a stale table. */
function back(period: string, query: string) {
  return `/admin/commissions?mois=${period}&${query}&t=${Date.now()}` as Route;
}

export async function recomputeAction(formData: FormData) {
  const session = await requireAdmin();
  const period = periodOfForm(formData);
  let error: AdminErrorCode | undefined;
  try {
    if (!canManageCommissions(session.role)) throw new AdminError("forbidden");
    await refreshDraftStatements(getDb(), period);
  } catch (err) {
    error = codeOf(err);
  }
  revalidatePath("/admin/commissions");
  redirect(back(period, error ? `error=${error}` : "ok=recomputed"));
}

/** Approves the agent's statement for the month, writing the draft first when nothing is stored yet. */
export async function approveAction(formData: FormData) {
  const session = await requireAdmin();
  const period = periodOfForm(formData);
  let error: AdminErrorCode | undefined;
  try {
    if (!canManageCommissions(session.role)) throw new AdminError("forbidden");
    const db = getDb();
    const statement = await upsertDraft(db, str(formData, "agentId"), period);
    await approveStatement(db, session, statement.id, await requestContext());
  } catch (err) {
    error = codeOf(err);
  }
  revalidatePath("/admin/commissions");
  redirect(back(period, error ? `error=${error}` : "ok=approved"));
}

export async function markPaidAction(formData: FormData) {
  const session = await requireAdmin();
  const period = periodOfForm(formData);
  let error: AdminErrorCode | undefined;
  try {
    await markPaid(
      getDb(),
      session,
      str(formData, "statementId"),
      { reference: str(formData, "reference") },
      await requestContext(),
    );
  } catch (err) {
    error = codeOf(err);
  }
  revalidatePath("/admin/commissions");
  redirect(back(period, error ? `error=${error}` : "ok=paid"));
}

export async function createRuleAction(formData: FormData) {
  const session = await requireAdmin();
  const period = periodOfForm(formData);
  const basis = str(formData, "basis");
  const rate = str(formData, "ratePct").replace(",", ".");
  const amount = str(formData, "amountFc").replace(/\s/g, "");
  let error: AdminErrorCode | undefined;
  try {
    await createCommissionRule(
      getDb(),
      session,
      {
        basis: basis as "collection_percent" | "registration_fixed",
        rateBp: rate === "" ? undefined : Math.round(Number(rate) * 100),
        amountFc: amount === "" ? undefined : Math.round(Number(amount)),
        effectiveFrom: str(formData, "effectiveFrom"),
      },
      await requestContext(),
    );
  } catch (err) {
    error = codeOf(err);
  }
  revalidatePath("/admin/commissions");
  redirect(back(period, error ? `error=${error}` : "ok=rule"));
}
