"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";

import { AdminError, type AdminErrorCode } from "@/lib/admin/errors";
import { approveRuleVersion, proposeRuleVersion } from "@/lib/admin/taxes";
import { changeEntityCategory, updateTaxpayerContact } from "@/lib/admin/taxpayers";
import { getDb } from "@/lib/db/client";
import { requireAdmin } from "@/lib/identity/session";
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
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/admin/login?error=1");
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
