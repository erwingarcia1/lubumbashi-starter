"use server";

import type { Route } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";

import { AdminError, type AdminErrorCode } from "@/lib/admin/errors";
import { getDb } from "@/lib/db/client";
import { requireAdmin } from "@/lib/identity/session";
import { createManualObligation } from "@/lib/invoices/create";
import { requestNow } from "@/lib/time";

export type CreateNoteState =
  | { status: "idle" }
  | { status: "error"; code: AdminErrorCode; detail?: string; existingInvoiceNo?: string };

async function requestContext() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: forwarded || h.get("x-real-ip") || undefined,
    userAgent: h.get("user-agent") ?? undefined,
  };
}

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

/**
 * « Créer et générer la note » : creates the obligation and issues its note in one transaction,
 * then lands back on the screen with `?note=<AV-…>` for the green banner and the PDF link. A
 * refusal comes back as state so the form keeps what was typed (useActionState); the
 * `duplicate_period` state carries the number of the note that already exists.
 */
export async function createNoteAction(
  _state: CreateNoteState,
  formData: FormData,
): Promise<CreateNoteState> {
  const session = await requireAdmin();
  const taxpayerNo = str(formData, "taxpayerNo");
  const q = str(formData, "q");
  const amountRaw = str(formData, "amountFc").replace(/[\s ]/g, "");
  let invoiceNo: string;
  try {
    const created = await createManualObligation(
      getDb(),
      session,
      {
        taxpayerNo,
        entityId: str(formData, "entityId"),
        taxRuleCode: str(formData, "taxRuleCode"),
        periodStart: `${str(formData, "month")}-01`,
        dueDate: str(formData, "dueDate"),
        amountFc: amountRaw === "" ? undefined : Number(amountRaw),
        reason: str(formData, "reason") || undefined,
        label: str(formData, "label") || undefined,
      },
      await requestContext(),
      requestNow(),
    );
    invoiceNo = created.invoiceNo;
  } catch (err) {
    if (err instanceof AdminError) {
      return {
        status: "error",
        code: err.code,
        ...(err.detail ? { detail: err.detail } : {}),
        ...(err.code === "duplicate_period" && err.detail ? { existingInvoiceNo: err.detail } : {}),
      };
    }
    if (err instanceof ZodError) return { status: "error", code: "invalid_input" };
    throw err;
  }
  const query = new URLSearchParams({ contribuable: taxpayerNo, note: invoiceNo });
  if (q) query.set("q", q);
  redirect(`/admin/notes-de-perception?${query.toString()}` as Route);
}
