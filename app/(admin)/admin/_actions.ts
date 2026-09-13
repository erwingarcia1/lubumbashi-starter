"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";

import { createAgent, resetAgentPin, revokeDevice } from "@/lib/admin/agents";
import { requestPaymentReversal } from "@/lib/admin/payments";
import { createAdminUser, setAdminActive, setAdminRole } from "@/lib/admin/users";
import type { AdminRole } from "@/lib/identity/roles";
import { AdminError, type AdminErrorCode } from "@/lib/admin/errors";
import { approveRuleVersion, proposeRuleVersion } from "@/lib/admin/taxes";
import { changeEntityCategory, updateTaxpayerContact } from "@/lib/admin/taxpayers";
import { getDb } from "@/lib/db/client";
import { requireAdmin } from "@/lib/identity/session";
import { availableChannels } from "@/lib/payments/registry";
import {
  attachToTaxpayer,
  closeDay,
  confirmFromStatement,
  requeryProvider,
  requestReversal,
  resolveManually,
} from "@/lib/reconciliation/actions";
import { reconcileDay } from "@/lib/reconciliation/run";
import { clientKey, limits } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/identity/supabase";

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
const int = (formData: FormData, key: string) =>
  Math.round(Number(str(formData, key).replace(/\s/g, "")));

export async function signInAction(formData: FormData) {
  const email = str(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = str(formData, "next");
  // Failed attempts are rate-limited per IP; a successful login clears the counter.
  const key = clientKey((await requestContext()).ip);
  const verdict = limits.adminLogin.check(key);
  if (!verdict.ok) redirect("/admin/login?error=rate");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/admin/login?error=1");
  limits.adminLogin.reset(key);
  redirect((next.startsWith("/admin") ? next : "/admin") as Route);
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

export async function proposeVersionAction(formData: FormData) {
  const session = await requireAdmin();
  const ruleCode = str(formData, "ruleCode");
  const penaltyPct = str(formData, "penaltyPct");
  let error: AdminErrorCode | undefined;
  try {
    await proposeRuleVersion(
      getDb(),
      session,
      {
        ruleCode,
        amountFc: int(formData, "amountFc"),
        effectiveFrom: str(formData, "effectiveFrom"),
        penaltyRateBp: penaltyPct === "" ? null : Math.round(Number(penaltyPct) * 100),
        graceDays: int(formData, "graceDays"),
        referenceDocument: str(formData, "referenceDocument") || undefined,
        notesFr: str(formData, "notesFr") || undefined,
      },
      await requestContext(),
    );
  } catch (err) {
    error = codeOf(err);
  }
  revalidatePath("/admin/taxes");
  redirect(
    error ? `/admin/taxes/${ruleCode}?error=${error}` : `/admin/taxes/${ruleCode}?ok=proposed`,
  );
}

export async function approveVersionAction(formData: FormData) {
  const session = await requireAdmin();
  const ruleCode = str(formData, "ruleCode");
  const versionId = str(formData, "versionId");
  let error: AdminErrorCode | undefined;
  try {
    await approveRuleVersion(getDb(), session, versionId, await requestContext());
  } catch (err) {
    error = codeOf(err);
  }
  revalidatePath("/admin/taxes");
  redirect(
    error ? `/admin/taxes/${ruleCode}?error=${error}` : `/admin/taxes/${ruleCode}?ok=approved`,
  );
}

export async function updateContactAction(formData: FormData) {
  const session = await requireAdmin();
  const taxpayerNo = str(formData, "taxpayerNo");
  let error: AdminErrorCode | undefined;
  try {
    await updateTaxpayerContact(
      getDb(),
      session,
      {
        taxpayerNo,
        phone: str(formData, "phone").replace(/\s/g, ""),
        address: str(formData, "address"),
      },
      await requestContext(),
    );
  } catch (err) {
    error = codeOf(err);
  }
  revalidatePath(`/admin/contribuables/${taxpayerNo}`);
  redirect(
    error
      ? `/admin/contribuables/${taxpayerNo}?error=${error}`
      : `/admin/contribuables/${taxpayerNo}?ok=contact`,
  );
}

export async function changeCategoryAction(formData: FormData) {
  const session = await requireAdmin();
  const taxpayerNo = str(formData, "taxpayerNo");
  let error: AdminErrorCode | undefined;
  try {
    await changeEntityCategory(
      getDb(),
      session,
      {
        entityId: str(formData, "entityId"),
        categoryCode: str(formData, "categoryCode"),
        reason: str(formData, "reason"),
      },
      await requestContext(),
    );
  } catch (err) {
    error = codeOf(err);
  }
  revalidatePath(`/admin/contribuables/${taxpayerNo}`);
  redirect(
    error
      ? `/admin/contribuables/${taxpayerNo}?error=${error}`
      : `/admin/contribuables/${taxpayerNo}?ok=category`,
  );
}

export async function revokeDeviceAction(formData: FormData) {
  const session = await requireAdmin();
  let error: AdminErrorCode | undefined;
  try {
    await revokeDevice(
      getDb(),
      session,
      { deviceId: str(formData, "deviceId"), reason: str(formData, "reason") },
      await requestContext(),
    );
  } catch (err) {
    error = codeOf(err);
  }
  revalidatePath("/admin/agents");
  redirect(error ? `/admin/agents?error=${error}` : "/admin/agents?ok=revoked");
}

// --- Rapprochement (M9) -------------------------------------------------------------------------

/** A unique `t` makes every redirect a real navigation, so the page never shows a stale table. */
function reconPath(day: string, query: string) {
  return `/admin/rapprochement?day=${day}&${query}&t=${Date.now()}` as Route;
}

export async function runReconciliationAction(formData: FormData) {
  const session = await requireAdmin();
  const day = str(formData, "day");
  let error: AdminErrorCode | undefined;
  try {
    if (!(session.role === "finances" || session.role === "administrateur"))
      throw new AdminError("forbidden");
    await reconcileDay(getDb(), day, availableChannels());
  } catch (err) {
    error = codeOf(err);
  }
  revalidatePath("/admin/rapprochement");
  redirect(reconPath(day, error ? `error=${error}` : "ok=run"));
}

export async function reconciliationExceptionAction(formData: FormData) {
  const session = await requireAdmin();
  const day = str(formData, "day");
  const exceptionId = str(formData, "exceptionId");
  const action = str(formData, "action");
  const ctx = await requestContext();
  let error: AdminErrorCode | undefined;
  let ok = action;
  try {
    const db = getDb();
    if (action === "requery") {
      const r = await requeryProvider(db, session, { exceptionId }, ctx);
      ok = r.resolved ? "requery_resolved" : "requery_open";
    } else if (action === "reversal") {
      await requestReversal(db, session, { exceptionId, reason: str(formData, "reason") }, ctx);
    } else if (action === "attach") {
      await attachToTaxpayer(
        db,
        session,
        { exceptionId, taxpayerNo: str(formData, "taxpayerNo").toUpperCase() },
        ctx,
      );
    } else if (action === "confirm") {
      await confirmFromStatement(db, session, { exceptionId }, ctx);
    } else if (action === "resolve") {
      await resolveManually(
        db,
        session,
        { exceptionId, resolution: str(formData, "resolution") },
        ctx,
      );
    } else {
      throw new AdminError("invalid_input", action);
    }
  } catch (err) {
    error = codeOf(err);
  }
  revalidatePath("/admin/rapprochement");
  redirect(reconPath(day, error ? `error=${error}` : `ok=${ok}`));
}

export async function closeDayAction(formData: FormData) {
  const session = await requireAdmin();
  const day = str(formData, "day");
  let error: AdminErrorCode | undefined;
  try {
    await closeDay(
      getDb(),
      session,
      { businessDate: day, note: str(formData, "note") || undefined },
      await requestContext(),
    );
  } catch (err) {
    error = codeOf(err);
  }
  revalidatePath("/admin/rapprochement");
  redirect(reconPath(day, error ? `error=${error}` : "ok=closed"));
}

// --- Agent accounts --------------------------------------------------------------------------

export async function createAgentAction(formData: FormData) {
  const session = await requireAdmin();
  let error: AdminErrorCode | undefined;
  let matricule = "";
  try {
    const created = await createAgent(
      getDb(),
      session,
      {
        fullName: str(formData, "fullName"),
        phone: str(formData, "phone"),
        quartierId: str(formData, "quartierId"),
        pin: str(formData, "pin"),
      },
      await requestContext(),
    );
    matricule = created.matricule;
  } catch (err) {
    error = codeOf(err);
  }
  revalidatePath("/admin/agents");
  redirect(
    (error
      ? `/admin/agents?error=${error}`
      : `/admin/agents?ok=created&matricule=${encodeURIComponent(matricule)}`) as Route,
  );
}

export async function resetAgentPinAction(formData: FormData) {
  const session = await requireAdmin();
  let error: AdminErrorCode | undefined;
  try {
    await resetAgentPin(
      getDb(),
      session,
      { agentId: str(formData, "agentId"), pin: str(formData, "pin") },
      await requestContext(),
    );
  } catch (err) {
    error = codeOf(err);
  }
  revalidatePath("/admin/agents");
  redirect(error ? `/admin/agents?error=${error}` : "/admin/agents?ok=pin");
}

// --- Mairie users (Réglages) ----------------------------------------------------------------

export type CreateUserState =
  | { status: "idle" }
  | { status: "created"; email: string; temporaryPassword: string }
  | { status: "error"; code: AdminErrorCode };

/** Returns the temporary password to the form (never through a redirect URL or a log). */
export async function createAdminUserAction(
  _state: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  const session = await requireAdmin();
  try {
    const r = await createAdminUser(
      getDb(),
      session,
      {
        email: str(formData, "email"),
        fullName: str(formData, "fullName"),
        role: str(formData, "role") as AdminRole,
      },
      await requestContext(),
    );
    revalidatePath("/admin/reglages");
    return { status: "created", email: r.email, temporaryPassword: r.temporaryPassword };
  } catch (err) {
    return { status: "error", code: codeOf(err) };
  }
}

export async function setAdminRoleAction(formData: FormData) {
  const session = await requireAdmin();
  let error: AdminErrorCode | undefined;
  try {
    await setAdminRole(
      getDb(),
      session,
      { adminId: str(formData, "adminId"), role: str(formData, "role") as AdminRole },
      await requestContext(),
    );
  } catch (err) {
    error = codeOf(err);
  }
  revalidatePath("/admin/reglages");
  redirect(error ? `/admin/reglages?error=${error}` : "/admin/reglages?ok=role");
}

export async function setAdminActiveAction(formData: FormData) {
  const session = await requireAdmin();
  let error: AdminErrorCode | undefined;
  try {
    await setAdminActive(
      getDb(),
      session,
      { adminId: str(formData, "adminId"), active: str(formData, "active") === "1" },
      await requestContext(),
    );
  } catch (err) {
    error = codeOf(err);
  }
  revalidatePath("/admin/reglages");
  redirect(error ? `/admin/reglages?error=${error}` : "/admin/reglages?ok=active");
}

export async function reversePaymentAction(formData: FormData) {
  const session = await requireAdmin();
  const taxpayerNo = str(formData, "taxpayerNo");
  let error: AdminErrorCode | undefined;
  try {
    await requestPaymentReversal(
      getDb(),
      session,
      { reference: str(formData, "reference"), reason: str(formData, "reason") },
      await requestContext(),
    );
  } catch (err) {
    error = codeOf(err);
  }
  revalidatePath(`/admin/contribuables/${taxpayerNo}`);
  redirect(
    (error
      ? `/admin/contribuables/${taxpayerNo}?error=${error}`
      : `/admin/contribuables/${taxpayerNo}?ok=reversed`) as Route,
  );
}
