"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { parseScannedTaxpayerNo } from "@/lib/census/qr";
import { formatFC } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";

import { Pill } from "../../../../(admin)/admin/_components/pill";

interface Hit {
  taxpayerNo: string;
  fullName: string;
  phoneMasked: string;
  pill: "paid" | "due" | "late";
  outstandingFc: number;
}

const tone = { paid: "ok", due: "warn", late: "bad" } as const;

/**
 * Camera scanning with the native BarcodeDetector when present, @zxing/browser otherwise (loaded
 * only here); the search box is also where a hardware scanner (keyboard wedge) types.
 */
export function Scanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<string>(t.agent.scan.searching);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);

  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    const video = videoRef.current;
    if (!video || !navigator.mediaDevices?.getUserMedia) {
      setStatus(t.agent.scan.noCamera);
      return;
    }
    const onCode = (raw: string) => {
      const no = parseScannedTaxpayerNo(raw);
      if (no) {
        stop();
        router.push(`/agent/contribuables/${no}`);
      }
    };
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        const Detector = (
          window as unknown as {
            BarcodeDetector?: new (o: { formats: string[] }) => {
              detect(v: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
            };
          }
        ).BarcodeDetector;
        if (Detector) {
          const detector = new Detector({ formats: ["qr_code"] });
          const timer = window.setInterval(async () => {
            try {
              const codes = await detector.detect(video);
              if (codes[0]) onCode(codes[0].rawValue);
            } catch {
              /* frame not ready */
            }
          }, 300);
          stop = () => {
            window.clearInterval(timer);
            stream.getTracks().forEach((tr) => tr.stop());
          };
        } else {
          const { BrowserQRCodeReader } = await import("@zxing/browser");
          const reader = new BrowserQRCodeReader();
          const controls = await reader.decodeFromVideoElement(video, (result) => {
            if (result) onCode(result.getText());
          });
          stop = () => {
            controls.stop();
            stream.getTracks().forEach((tr) => tr.stop());
          };
        }
      } catch {
        setStatus(t.agent.scan.noCamera);
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [router]);

  async function search(value: string) {
    const no = parseScannedTaxpayerNo(value);
    if (no) {
      router.push(`/agent/contribuables/${no}`);
      return;
    }
    if (value.trim().length < 3) {
      setHits(null);
      return;
    }
    const res = await fetch(`/api/v1/taxpayers/search?q=${encodeURIComponent(value.trim())}`);
    const json = (await res.json()) as { ok: boolean; data?: Hit[] };
    setHits(json.ok ? (json.data ?? []) : []);
  }

  return (
    <div className="flex flex-1 flex-col gap-3 px-4 py-3.5">
      <div className="relative grid h-[280px] place-items-center overflow-hidden rounded-lg bg-[#1B1B1F] text-white">
        <video
          ref={videoRef}
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="relative h-[190px] w-[190px] rounded-xl border-[3px] border-white shadow-[0_0_0_999px_rgba(0,0,0,.45)]" />
        <div className="absolute bottom-3 text-[12px] opacity-85">{status}</div>
      </div>
      <p className="text-center text-[12.5px] text-[#5C5456]">{t.agent.scan.fallback}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(q);
        }}
      >
        <Input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            void search(e.target.value);
          }}
          placeholder={`🔍 ${t.agent.scan.searchPlaceholder}`}
          className="h-12 text-base"
          aria-label={t.agent.scan.searchPlaceholder}
        />
      </form>
      {hits ? (
        <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3">
          <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
            {t.agent.scan.recent}
          </p>
          {hits.length === 0 ? (
            <p className="py-2 text-[12.5px] text-[#5C5456]">{t.agent.scan.noResult}</p>
          ) : null}
          {hits.map((h) => (
            <Link
              key={h.taxpayerNo}
              href={`/agent/contribuables/${h.taxpayerNo}` as never}
              className="flex min-h-12 items-center gap-2.5 border-b border-[#EFEAEA] py-2.5 last:border-0"
            >
              <div className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[#F9E3E5] text-[13px] font-bold text-[#8B0F1A]">
                {h.fullName[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold">{h.fullName}</div>
                <div className="truncate font-mono text-[12.5px] text-[#5C5456]">
                  {h.taxpayerNo} · {h.phoneMasked}
                </div>
              </div>
              <div className="text-right">
                <Pill tone={tone[h.pill]}>{t.status.pill[h.pill]}</Pill>
                <div className="font-mono text-[11px] text-[#5C5456]">
                  {formatFC(h.outstandingFc)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
