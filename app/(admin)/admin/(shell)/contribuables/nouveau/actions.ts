"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";

import { AdminError, type AdminErrorCode } from "@/lib/admin/errors";
import { registerFromBackOffice } from "@/lib/admin/register";
import { CensusError } from "@/lib/census/register";
import { getDb } from "@/lib/db/client";
import { requireAdmin } from "@/lib/identity/session";
import { flushNotificationsSoon } from "@/lib/notify/flush";

export type CreateTaxpayerState =
  { status: "idle" } | { status: "error"; code: AdminErrorCode; existingTaxpayerNo?: string };

async function requestContext() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: forwarded || h.get("x-real-ip") || undefined,
    userAgent: h.get("user-agent") ?? undefined,
  };
}

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const num = (formData: FormData, key: string): number | undefined => {
  const raw = str(formData, key).replace(/\s/g, "");
  return raw === "" ? undefined : Number(raw);
};

/**
 * Registers the taxpayer from the form; the form keeps its fields on error (useActionState) and
 * the success lands on the new taxpayer's page. Amounts arrive as integers of FC; the server
 * (lib/census/schema) is the validator, the browser attributes only help.
 */
export async function createTaxpayerAction(
  _state: CreateTaxpayerState,
  formData: FormData,
): Promise<CreateTaxpayerState> {
  const session = await requireAdmin();
  const kind = str(formData, "kind") === "company" ? "company" : "person";
  const address = str(formData, "address");
  const contactName = str(formData, "contactName");
  const idNumber = str(formData, "idNumber");
  const entityName = str(formData, "entityName");
  let taxpayerNo: string;
  try {
    const result = await registerFromBackOffice(
      getDb(),
      session,
      {
        clientUuid: str(formData, "clientUuid"),
        taxpayer: {
          kind,
          fullName: str(formData, "fullName"),
          contactName: kind === "company" && contactName ? contactName : undefined,
          phone: str(formData, "phone").replace(/\s/g, ""),
          idType: idNumber ? "carte_electeur" : undefined,
          idNumber: idNumber || undefined,
          communeCode: str(formData, "communeCode"),
          quartierCode: str(formData, "quartierCode"),
          address,
        },
        entity: {
          kind: str(formData, "entityKind") as "property" | "business" | "activity",
          categoryCode: str(formData, "categoryCode"),
          name: entityName || address,
          gps: { lng: num(formData, "lng") as number, lat: num(formData, "lat") as number },
          taxBaseFc: num(formData, "taxBaseFc"),
        },
      },
      await requestContext(),
    );
    if (result.created) flushNotificationsSoon();
    taxpayerNo = result.taxpayerNo;
  } catch (err) {
    if (err instanceof AdminError)
      return {
        status: "error",
        code: err.code,
        ...(err.code === "duplicate_phone" && err.detail ? { existingTaxpayerNo: err.detail } : {}),
      };
    if (err instanceof ZodError || err instanceof CensusError)
      return { status: "error", code: "invalid_input" };
    throw err;
  }
  revalidatePath("/admin/contribuables");
  redirect(`/admin/contribuables/${taxpayerNo}?ok=created` as Route);
}
