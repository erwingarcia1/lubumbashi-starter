"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDateTimeFr, formatFC } from "@/lib/i18n/format";
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

interface Receipt {
  receiptNo: string;
  allocations: Array<{
    ruleLabelFr: string;
    periodStart: string;
    periodEnd: string;
    kind: string;
    amountFc: number;
  }>;
  issuedAt: string;
}

const COLORS: Record<Channel, string> = {
  mpesa: "#C1121F",
  airtel: "#B3261E",
  orange: "#B7791F",
  tpe: "#2F4CA3",
};
const P = t.agent.pay;
const WAIT_SECONDS = 120;

function monthFr(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Lubumbashi",
    month: "short",
    year: "numeric",
  }).format(new Date(`${iso}T12:00:00+02:00`));
}

export function CollectFlow({
  taxpayerNo,
  taxpayerName,
  phone,
  outstandingFc,
  channels,
  agentMatricule,
}: {
  taxpayerNo: string;
  taxpayerName: string;
  phone: string;
  outstandingFc: number;
  channels: Channel[];
  agentMatricule: string;
}) {
  const [channel, setChannel] = useState<Channel>(channels[0] ?? "mpesa");
  const [view, setView] = useState<View | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<number | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      let gps: { lng: number; lat: number } | undefined;
      if ("geolocation" in navigator) {
        gps = await new Promise((resolve) =>
          navigator.geolocation.getCurrentPosition(
            (p) => resolve({ lng: p.coords.longitude, lat: p.coords.latitude }),
            () => resolve(undefined),
            { timeout: 4000, maximumAge: 60_000 },
          ),
        );
      }
      const res = await fetch("/api/v1/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taxpayerNo, channel, gps }),
      });
      const json = (await res.json()) as { ok: boolean; data?: View; error?: { code: string } };
      if (!json.ok || !json.data) {
        const code = json.error?.code as keyof typeof P.errors | undefined;
        setError((code && P.errors[code]) ?? P.errors.network);
        return;
      }
      setView(json.data);
      setElapsed(0);
    } catch {
      setError(P.errors.network);
    } finally {
      setBusy(false);
    }
  }

  // Poll the platform (which re-queries the provider) while pending; never sets the status itself.
  useEffect(() => {
    if (!view || (view.status !== "pending" && view.status !== "initiated")) return;
    const id = window.setInterval(async () => {
      setElapsed((e) => e + 2);
      try {
        const res = await fetch(`/api/v1/payments/${view.reference}`);
        const json = (await res.json()) as { ok: boolean; data?: View };
        if (json.ok && json.data && json.data.status !== view.status) setView(json.data);
      } catch {
        /* keep polling */
      }
    }, 2000);
    timer.current = id;
    return () => window.clearInterval(id);
  }, [view]);

  useEffect(() => {
    if (!view?.receiptNo) return;
    void fetch(`/api/v1/receipts/${view.receiptNo}`)
      .then((r) => r.json() as Promise<{ ok: boolean; data?: Receipt }>)
      .then((j) => (j.ok && j.data ? setReceipt(j.data) : undefined));
  }, [view?.receiptNo]);

  const labels: Record<Channel, string> = {
    mpesa: t.status.channel.mpesa,
    airtel: t.status.channel.airtel,
    orange: t.status.channel.orange,
    tpe: t.status.channel.tpe,
  };

  if (view?.status === "confirmed") {
    const verifyPath =
      view.receiptNo && view.verifyToken ? `/v/${view.receiptNo}/${view.verifyToken}` : null;
    return (
      <div className="flex flex-1 flex-col gap-3 px-4 py-3.5">
        <div className="text-center">
          <div className="bg-ok mx-auto my-2 grid h-16 w-16 place-items-center rounded-full text-[34px] text-white">
            ✓
          </div>
          <div className="text-[16px] font-bold">{P.received}</div>
          <div className="font-mono text-[22px] font-bold">{formatFC(view.amountFc)}</div>
        </div>
        <div className="rounded-md border border-dashed border-[#C9C2C2] bg-white p-3.5 text-[13px]">
          <div className="mb-2 border-b border-[#E3DEDE] pb-2 text-center">
            <b className="block text-[13px]">{t.receipt.city}</b>
            <small className="text-[#5C5456]">{t.receipt.official}</small>
          </div>
          {[
            [t.receipt.number, view.receiptNo ?? "…"],
            [t.receipt.taxpayer, taxpayerName],
            [t.receipt.id, taxpayerNo],
            [
              t.receipt.period,
              receipt
                ? receipt.allocations
                    .map((a) => `${a.ruleLabelFr} · ${monthFr(a.periodStart)}`)
                    .join(" ; ")
                : "…",
            ],
            [t.receipt.amount, formatFC(view.amountFc)],
            [t.receipt.channel, `${labels[channel]} · ${view.providerReference ?? ""}`],
            [
              t.receipt.agent,
              `${agentMatricule} · ${receipt ? formatDateTimeFr(new Date(receipt.issuedAt)) : ""}`,
            ],
          ].map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between gap-2 border-b border-[#EFEAEA] py-1.5 last:border-0"
            >
              <span>{k}</span>
              <b className="text-right font-mono">{v}</b>
            </div>
          ))}
          {verifyPath ? (
            <div className="mt-2 text-center text-[11px] text-[#5C5456]">
              {t.receipt.verify} {verifyPath}
            </div>
          ) : null}
        </div>
        <p className="text-center text-[12.5px] text-[#5C5456]">
          {P.smsSent} {phone} ✓
        </p>
        {view.receiptNo ? (
          <a
            href={`/api/v1/receipts/${view.receiptNo}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="block min-h-12 rounded-lg border border-[#D5CFCF] bg-white px-3.5 py-3 text-center text-[15px] font-semibold"
          >
            {P.pdf}
          </a>
        ) : null}
        <Link
          href="/agent"
          className="bg-ok block min-h-12 rounded-lg px-3.5 py-3 text-center text-[15px] font-semibold text-white"
        >
          {P.finish}
        </Link>
      </div>
    );
  }

  if (view?.status === "failed") {
    return (
      <div className="flex flex-1 flex-col gap-3 px-4 py-3.5">
        <div className="border-bad bg-bad-soft rounded border-l-4 px-3 py-2 text-[12.5px]">
          <b>
            {P.refusedBy} {labels[channel]}
          </b>{" "}
          — {view.failureReason}
        </div>
        <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-2.5 text-[12.5px]">
          {[
            [P.reference, view.reference],
            [t.admin.taxpayers.columns.status, P.statusFailed],
            [P.balance, `${formatFC(outstandingFc)} ${P.unchanged}`],
          ].map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between gap-2 border-b border-[#EFEAEA] py-1.5 last:border-0"
            >
              <span>{k}</span>
              <b className="text-right font-mono">{v}</b>
            </div>
          ))}
        </div>
        <p className="text-[12.5px] text-[#5C5456]">{P.logged}</p>
        <Button onClick={() => setView(null)} className="h-12 text-[15px]">
          {P.retry}
        </Button>
        <Link
          href="/agent"
          className="block min-h-12 rounded-lg border border-[#D5CFCF] bg-white px-3.5 py-3 text-center text-[15px] font-semibold"
        >
          {P.backToRoute}
        </Link>
      </div>
    );
  }

  if (view) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-3.5 text-center">
        <div className="h-11 w-11 animate-spin rounded-full border-4 border-[#ECE7E7] border-t-[#C1121F]" />
        <div className="text-[16px] font-bold">{P.sent}</div>
        <p className="text-[12.5px] text-[#5C5456]">
          {taxpayerName} {P.mustConfirm}
          <br />
          {P.validatedOnly}
        </p>
        <div className="w-full rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-2.5 text-left text-[12.5px]">
          {[
            [P.amount, formatFC(view.amountFc)],
            [P.channel, labels[channel]],
            [P.reference, view.reference],
            [
              P.delay,
              `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")} / ${WAIT_SECONDS / 60}:00`,
            ],
          ].map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between gap-2 border-b border-[#EFEAEA] py-1.5 last:border-0"
            >
              <span>{k}</span>
              <b className="font-mono">{v}</b>
            </div>
          ))}
        </div>
        {elapsed >= WAIT_SECONDS ? (
          <p className="text-[12.5px] text-[#5C5456]">{P.stillWaiting}</p>
        ) : null}
        {elapsed >= WAIT_SECONDS ? (
          <Link
            href="/agent"
            className="block min-h-12 w-full rounded-lg border border-[#D5CFCF] bg-white px-3.5 py-3 text-center text-[15px] font-semibold"
          >
            {P.backToRoute}
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 px-4 py-3.5">
      <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3">
        <div className="text-[12.5px] text-[#5C5456]">{P.amount}</div>
        <div className="font-mono text-[28px] leading-tight font-bold">
          {formatFC(outstandingFc)}
        </div>
      </div>
      <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">{P.channel}</p>
      {channels.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => setChannel(c)}
          className={`flex min-h-12 items-center gap-3 rounded-lg border bg-white p-3 text-left ${channel === c ? "border-[#C1121F] ring-2 ring-[#F9E3E5]" : "border-[#E3DEDE]"}`}
        >
          <span
            className="grid h-10 w-10 flex-none place-items-center rounded-md text-[12px] font-bold text-white"
            style={{ background: COLORS[c] }}
          >
            {labels[c].slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{labels[c]}</span>
            <span className="block text-[12.5px] text-[#5C5456]">
              {c === "tpe" ? P.tpeHint : P.channelHint}
            </span>
          </span>
          {channel === c ? <span className="font-bold text-[#C1121F]">●</span> : null}
        </button>
      ))}
      <div className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold text-[#5C5456]">{P.payerPhone}</span>
        <div className="min-h-10 rounded-md border border-[#D5CFCF] bg-white px-3 py-2.5 font-mono text-[14px]">
          {phone}
        </div>
      </div>
      {error ? (
        <p className="border-bad bg-bad-soft rounded border-l-4 px-3 py-2 text-[12.5px]">{error}</p>
      ) : null}
      <div className="mt-auto">
        <Button
          onClick={send}
          disabled={busy || outstandingFc <= 0}
          className="h-12 w-full text-[15px]"
        >
          {busy ? P.sending : P.send}
        </Button>
        <p className="mt-1.5 text-center text-[12.5px] text-[#5C5456]">{P.noCash}</p>
      </div>
    </div>
  );
}
