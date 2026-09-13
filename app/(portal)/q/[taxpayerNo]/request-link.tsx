"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";

/** Door-sticker landing: asks the server to SMS a fresh signed link to the phone on file. */
export function RequestLink({ taxpayerNo }: { taxpayerNo: string }) {
  const [state, setState] = useState<"idle" | "busy" | "sent" | "cooldown" | "error">("idle");
  const [masked, setMasked] = useState<string | null>(null);

  async function request() {
    setState("busy");
    try {
      const res = await fetch("/api/v1/portal/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taxpayerNo }),
      });
      const json = (await res.json()) as { ok: boolean; data?: { phoneMasked: string } };
      if (json.ok) {
        setMasked(json.data?.phoneMasked ?? null);
        setState("sent");
      } else setState(res.status === 429 ? "cooldown" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "sent")
    return (
      <div className="border-ok rounded-lg border bg-[#F2FAF5] p-3.5 text-[13px]">
        <b className="text-ok">{t.portal.sticker.requested}</b>
        {masked ? <div className="font-mono text-[#5C5456]">{masked}</div> : null}
      </div>
    );
  return (
    <>
      {state === "error" || state === "cooldown" ? (
        <div className="border-bad bg-bad-soft text-bad rounded border-l-4 px-3 py-2 text-[12.5px]">
          {state === "cooldown" ? t.portal.sticker.cooldown : t.agent.pay.errors.network}
        </div>
      ) : null}
      <button
        type="button"
        onClick={request}
        disabled={state === "busy"}
        className="min-h-12 rounded-lg bg-[#C1121F] px-3.5 py-3 text-[15px] font-semibold text-white disabled:opacity-60"
      >
        {t.portal.sticker.request}
      </button>
    </>
  );
}
