"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

import { formatFC, formatMonthFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";

type Channel = "mpesa" | "airtel" | "orange" | "tpe";

interface View {
  reference: string;
  status: "initiated" | "pending" | "confirmed" | "failed" | "reversed" | "expired";
  amountFc: number;
  channel: Channel | "mock";
  failureReason: string | null;
  receiptNo: string | null;
  verifyToken: string | null;
  providerReference: string | null;
}

export interface PayableObligation {
  id: string;
  ruleLabelFr: string;
  periodStart: string;
  outstandingFc: number;
  late: boolean;
}

export type PayMode = { kind: "session" } | { kind: "invoice"; invoiceNo: string; token: string };

const COLORS: Record<Channel, string> = {
  mpesa: "#C1121F",
  airtel: "#B3261E",
  orange: "#B7791F",
  tpe: "#2F4CA3",
};
const P = t.portal.pay;

/** Screens p-pay → wait → confirmed/failed. The client never sets a status: it polls the server. */
export function PayFlow({
  mode,
  phone,
  obligations,
  channels,
  homeHref,
}: {
  mode: PayMode;
  phone: string;
  obligations: PayableObligation[];
  channels: Channel[];
  homeHref: string;
}) {
  const total = obligations.reduce((s, o) => s + o.outstandingFc, 0);
  const [selection, setSelection] = useState<"all" | string>("all");
  const [channel, setChannel] = useState<Channel>(channels[0] ?? "mpesa");
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  const amount =
    selection === "all" ? total : (obligations.find((o) => o.id === selection)?.outstandingFc ?? 0);
  const auth = mode.kind === "invoice" ? `?invoiceNo=${mode.invoiceNo}&token=${mode.token}` : "";

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/portal/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel,
          ...(selection !== "all" ? { obligationIds: [selection] } : {}),
          ...(mode.kind === "invoice"
            ? { invoice: { invoiceNo: mode.invoiceNo, token: mode.token } }
            : {}),
        }),
      });
      const json = (await res.json()) as { ok: boolean; data?: View; error?: { code: string } };
      if (!json.ok || !json.data) {
        const code = json.error?.code as keyof typeof t.agent.pay.errors | undefined;
        setError((code && t.agent.pay.errors[code]) ?? t.agent.pay.errors.network);
        return;
      }
      setView(json.data);
    } catch {
      setError(t.agent.pay.errors.network);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!view || (view.status !== "pending" && view.status !== "initiated")) return;
    const id = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/portal/payments/${view.reference}${auth}`);
        const json = (await res.json()) as { ok: boolean; data?: View };
        if (json.ok && json.data && json.data.status !== view.status) setView(json.data);
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [view, auth]);

  useEffect(() => {
    if (view?.status !== "confirmed" || !view.receiptNo || !view.verifyToken) return;
    const url = `${window.location.origin}/v/${view.receiptNo}/${view.verifyToken}`;
    void QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 220 }).then(setQr);
  }, [view]);

  const labels: Record<Channel, string> = {
    mpesa: t.status.channel.mpesa,
    airtel: t.status.channel.airtel,
    orange: t.status.channel.orange,
    tpe: t.status.channel.tpe,
  };

  if (view?.status === "confirmed") {
    return (
      <div className="flex flex-1 flex-col gap-3 px-4 py-3.5 text-center">
        <div className="bg-ok mx-auto my-2 grid h-16 w-16 place-items-center rounded-full text-[34px] text-white">
          ✓
        </div>
        <div className="text-[16px] font-bold">
          {P.thanks}{" "}
          {P.confirmedBy
            .replace("{amount}", formatFC(view.amountFc))
            .replace("{channel}", labels[channel])}
        </div>
        <div className="font-mono text-[13px] text-[#5C5456]">{view.receiptNo}</div>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt={t.receipt.verify}
            className="mx-auto h-[220px] w-[220px] rounded-md bg-white p-2"
          />
        ) : null}
        <p className="text-[12.5px] text-[#5C5456]">{P.showQr}</p>
        {view.receiptNo && view.verifyToken ? (
          <a
            href={`/api/v1/receipts/${view.receiptNo}/pdf?token=${view.verifyToken}`}
            target="_blank"
            rel="noreferrer"
            className="block min-h-12 rounded-lg border border-[#D5CFCF] bg-white px-3.5 py-3 text-[15px] font-semibold"
          >
            {t.portal.verify.pdf}
          </a>
        ) : null}
        <Link
          href={homeHref as never}
          className="bg-ok block min-h-12 rounded-lg px-3.5 py-3 text-[15px] font-semibold text-white"
        >
          {P.back}
        </Link>
      </div>
    );
  }

  if (view?.status === "failed" || view?.status === "expired") {
    return (
      <div className="flex flex-1 flex-col gap-3 px-4 py-3.5">
        <div className="border-bad bg-bad-soft rounded border-l-4 px-3 py-2 text-[12.5px]">
          <b>{P.failed}</b> {view.failureReason ?? t.status.payment[view.status]}
        </div>
        <div className="font-mono text-[12px] text-[#5C5456]">{view.reference}</div>
        <button
          type="button"
          onClick={() => setView(null)}
          className="min-h-12 rounded-lg bg-[#C1121F] px-3.5 py-3 text-[15px] font-semibold text-white"
        >
          {P.retry}
        </button>
        <Link
          href={homeHref as never}
          className="block min-h-12 rounded-lg border border-[#D5CFCF] bg-white px-3.5 py-3 text-center text-[15px] font-semibold"
        >
          {P.back}
        </Link>
      </div>
    );
  }

  if (view) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-3.5 text-center">
        <div className="h-11 w-11 animate-spin rounded-full border-4 border-[#ECE7E7] border-t-[#C1121F]" />
        <div className="text-[16px] font-bold">{P.waiting}</div>
        <div className="font-mono text-[12px] text-[#5C5456]">{view.reference}</div>
        <div className="font-mono text-[22px] font-bold">{formatFC(view.amountFc)}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 px-4 py-3.5">
      <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-2">
        <div className="py-1.5 text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
          {P.amountToPay}
        </div>
        {obligations.length > 1 ? (
          <label className="flex min-h-12 items-center gap-3 border-t border-[#EFEAEA] text-[14px]">
            <input
              type="radio"
              name="selection"
              checked={selection === "all"}
              onChange={() => setSelection("all")}
              className="h-5 w-5 accent-[#C1121F]"
            />
            <b className="font-mono">{formatFC(total)}</b>
            <span className="text-[#5C5456]">· {P.all}</span>
          </label>
        ) : null}
        {obligations.map((o) => (
          <label
            key={o.id}
            className="flex min-h-12 items-center gap-3 border-t border-[#EFEAEA] text-[14px]"
          >
            <input
              type="radio"
              name="selection"
              checked={selection === o.id || obligations.length === 1}
              onChange={() => setSelection(o.id)}
              className="h-5 w-5 accent-[#C1121F]"
            />
            <b className="font-mono">{formatFC(o.outstandingFc)}</b>
            <span className="text-[#5C5456]">
              · {o.ruleLabelFr} · {formatMonthFr(o.periodStart)}
              {o.late ? ` (${t.status.pill.late.toLowerCase()})` : ""}
            </span>
          </label>
        ))}
      </div>

      <div className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">{P.choose}</div>
      <div className="flex flex-col gap-2">
        {channels.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChannel(c)}
            aria-pressed={channel === c}
            className={`flex min-h-14 items-center gap-3 rounded-lg border bg-white px-3.5 text-left ${channel === c ? "border-[#C1121F] ring-2 ring-[#C1121F]/30" : "border-[#E3DEDE]"}`}
          >
            <span
              className="grid h-9 w-9 place-items-center rounded-md text-[12px] font-bold text-white"
              style={{ backgroundColor: COLORS[c] }}
            >
              {labels[c].slice(0, 2).toUpperCase()}
            </span>
            <span>
              <b className="block text-[14px]">{labels[c]}</b>
              <small className="text-[#5C5456]">{P.hint}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-2 text-[12.5px]">
        {[
          [P.yourNumber, phone],
          // DECISION-PENDING: D13 — who pays the mobile-money fee.
          [P.fees, P.feesPlaceholder],
          [P.receiptBySms, P.receiptBySmsValue],
        ].map(([k, v]) => (
          <div
            key={k}
            className="flex justify-between gap-2 border-b border-[#EFEAEA] py-1.5 last:border-0"
          >
            <span>{k}</span>
            <b className="text-right">{v}</b>
          </div>
        ))}
      </div>

      {error ? (
        <div className="border-bad bg-bad-soft text-bad rounded border-l-4 px-3 py-2 text-[12.5px]">
          {error}
        </div>
      ) : null}
      <button
        type="button"
        onClick={pay}
        disabled={busy || amount <= 0}
        className="min-h-12 rounded-lg bg-[#C1121F] px-3.5 py-3 text-[15px] font-semibold text-white disabled:opacity-60"
      >
        {busy ? P.sending : `${P.pay} ${formatFC(amount)}`}
      </button>
    </div>
  );
}
