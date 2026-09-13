import { getDb } from "@/lib/db/client";
import { formatDateTimeFr, formatFC } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { findReceipt } from "@/lib/receipts/lookup";
import { receiptPeriodLabel } from "@/lib/receipts/pdf";

export const dynamic = "force-dynamic";

function maskName(name: string): string {
  const parts = name.split(/\s+/);
  return parts.map((p, i) => (i === 0 ? p : `${p[0] ?? ""}.`)).join(" ");
}

/** Public, no login: anyone can check whether a receipt is real (screen p-verify). */
export default async function VerifyReceiptPage({
  params,
}: {
  params: Promise<{ receiptNo: string; token: string }>;
}) {
  const { receiptNo, token } = await params;
  const receipt = await findReceipt(getDb(), receiptNo, token);
  const V = t.portal.verify;
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-[#F6F5F2] text-[#1B1B1F]">
      <div className="flex items-center gap-2.5 bg-[#C1121F] px-4 pt-3.5 pb-3 text-white">
        <div className="grid h-[30px] w-[30px] place-items-center rounded-full bg-white text-[13px] font-bold text-[#C1121F]">
          L
        </div>
        <div>
          <div className="text-[15px] leading-tight font-bold">{V.title}</div>
          <div className="font-mono text-[11px] opacity-85">{receiptNo}</div>
        </div>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3.5">
        {receipt ? (
          <div
            className={`rounded-lg border p-3.5 ${receipt.status === "cancelled" ? "border-bad bg-bad-soft" : "border-ok bg-[#F2FAF5]"}`}
          >
            <div className="flex items-center gap-2.5">
              <div
                className={`grid h-10 w-10 place-items-center rounded-full text-[22px] text-white ${receipt.status === "cancelled" ? "bg-bad" : "bg-ok"}`}
              >
                {receipt.status === "cancelled" ? "✕" : "✓"}
              </div>
              <div>
                <div
                  className={`text-[16px] font-bold ${receipt.status === "cancelled" ? "text-bad" : "text-ok"}`}
                >
                  {receipt.status === "cancelled" ? V.cancelled : V.authentic}
                </div>
                <div className="text-[12.5px] text-[#5C5456]">
                  {receipt.status === "cancelled" ? V.cancelledBody : V.issuedBy}
                </div>
              </div>
            </div>
            <div className="mt-2.5 text-[12.5px]">
              {[
                [
                  t.receipt.taxpayer,
                  `${maskName(receipt.snapshot.taxpayerName)} · ••${receipt.snapshot.taxpayerNo.slice(-3)}`,
                ],
                [t.receipt.amount, formatFC(receipt.snapshot.amountFc)],
                [t.receipt.date, formatDateTimeFr(new Date(receipt.snapshot.issuedAt))],
                [
                  V.tax,
                  receipt.snapshot.allocations
                    .map((a) => `${a.ruleLabelFr} · ${receiptPeriodLabel(a)}`)
                    .join(" ; ") || t.common.none,
                ],
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
            <a
              href={`/api/v1/receipts/${receipt.receiptNo}/pdf?token=${token}`}
              className="mt-3 block min-h-12 rounded-lg border border-[#D5CFCF] bg-white px-3.5 py-3 text-center text-[15px] font-semibold"
            >
              {V.pdf}
            </a>
          </div>
        ) : (
          <div className="border-bad bg-bad-soft rounded-lg border p-3.5">
            <div className="text-bad text-[16px] font-bold">{V.notFound}</div>
            <p className="text-[12.5px] text-[#5C5456]">{V.notFoundBody}</p>
          </div>
        )}
        <div className="rounded-lg border border-[#E3DEDE] bg-white p-3.5 text-[12.5px]">
          <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">{V.why}</p>
          <p className="mt-1.5 text-[#5C5456]">{V.whyBody}</p>
        </div>
      </div>
    </div>
  );
}
