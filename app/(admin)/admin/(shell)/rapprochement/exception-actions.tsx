"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";

const R = t.admin.reconciliation;

type Kind = "requery" | "reversal" | "attach" | "confirm" | "resolve";

/** The action column of d-recon: one primary action per exception type, plus manual closure. */
export function ExceptionActions({
  day,
  exception,
  action,
}: {
  day: string;
  exception: {
    id: string;
    type: string;
    provider: string;
    paymentStatus: string | null;
  };
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [openForm, setOpenForm] = useState<Kind | null>(null);
  const primary: Kind | null =
    exception.type === "missing_at_provider"
      ? "requery"
      : exception.type === "duplicate_at_provider"
        ? "reversal"
        : exception.type === "missing_on_platform"
          ? "attach"
          : exception.type === "status_mismatch" &&
              (exception.paymentStatus === "pending" || exception.paymentStatus === "expired")
            ? "confirm"
            : null;
  const providerLabel =
    t.status.channel[exception.provider as keyof typeof t.status.channel] ?? exception.provider;
  const labels: Record<Kind, string> = {
    requery: `${R.actions.requery} ${providerLabel}`,
    reversal: R.actions.reversal,
    attach: R.actions.attach,
    confirm: R.actions.confirm,
    resolve: R.actions.resolve,
  };
  const needsForm = (k: Kind) => k === "reversal" || k === "attach" || k === "resolve";

  return (
    <div className="flex flex-col gap-1.5">
      {(primary ? [primary, "resolve" as Kind] : ["resolve" as Kind]).map((kind) =>
        needsForm(kind) && openForm !== kind ? (
          <button
            key={kind}
            type="button"
            onClick={() => setOpenForm(kind)}
            className={`h-8 rounded-md px-2.5 text-left text-[12px] font-semibold ${kind === primary ? "bg-[#C1121F] text-white" : "border border-[#D5CFCF] bg-white"}`}
          >
            {labels[kind]}
          </button>
        ) : (
          <form key={kind} action={action} className="flex flex-col gap-1">
            <input type="hidden" name="day" value={day} />
            <input type="hidden" name="exceptionId" value={exception.id} />
            <input type="hidden" name="action" value={kind} />
            {kind === "reversal" ? (
              <input
                name="reason"
                required
                minLength={5}
                placeholder={R.actions.reason}
                aria-label={R.actions.reason}
                className="h-8 rounded-md border border-[#D5CFCF] px-2 text-[12px]"
              />
            ) : null}
            {kind === "attach" ? (
              <input
                name="taxpayerNo"
                required
                pattern="LUB-[A-Za-z]{3}-\d{8}"
                placeholder="LUB-KAM-00000125"
                aria-label={R.actions.taxpayerNo}
                className="h-8 rounded-md border border-[#D5CFCF] px-2 font-mono text-[12px]"
              />
            ) : null}
            {kind === "resolve" ? (
              <input
                name="resolution"
                required
                minLength={5}
                placeholder={R.actions.resolution}
                aria-label={R.actions.resolution}
                className="h-8 rounded-md border border-[#D5CFCF] px-2 text-[12px]"
              />
            ) : null}
            <button
              type="submit"
              className={`h-8 rounded-md px-2.5 text-left text-[12px] font-semibold ${kind === primary ? "bg-[#C1121F] text-white" : "border border-[#D5CFCF] bg-white"}`}
            >
              {labels[kind]}
            </button>
          </form>
        ),
      )}
    </div>
  );
}
