import Link from "next/link";
import { notFound } from "next/navigation";

import { getTaxpayerDetail } from "@/lib/admin/taxpayers";
import { getDb } from "@/lib/db/client";
import { requireAgent } from "@/lib/identity/agent-session";
import { formatDateFr, formatFC } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { businessDate } from "@/lib/time";

import { Pill } from "../../../../../(admin)/admin/_components/pill";
import { AgentHeader } from "../../../_components/header";
import { ContactForm } from "./contact-form";

const tone = { paid: "ok", due: "warn", late: "bad" } as const;

export default async function AgentTaxpayerPage({
  params,
}: {
  params: Promise<{ taxpayerNo: string }>;
}) {
  await requireAgent();
  const { taxpayerNo } = await params;
  const d = await getTaxpayerDetail(getDb(), taxpayerNo);
  if (!d) notFound();
  const today = businessDate(new Date());
  const P = t.agent.profile;
  const lateSince = d.obligations
    .filter((o) => o.dueDate < today && (o.status === "due" || o.status === "partially_paid"))
    .map((o) => o.dueDate)
    .sort()[0];
  const nextDue = d.obligations
    .filter((o) => o.dueDate >= today && o.status !== "paid")
    .map((o) => o.dueDate)
    .sort()[0];
  const owes = d.balance.outstandingFc > 0;
  return (
    <>
      <AgentHeader
        title={d.taxpayer.fullName}
        subtitle={<span className="font-mono">{d.taxpayer.taxpayerNo}</span>}
        right={<Pill tone={tone[d.balance.pill]}>{t.status.pill[d.balance.pill]}</Pill>}
      />
      <div className="flex flex-1 flex-col gap-3 px-4 py-3.5">
        <div className="rounded-lg border-l-4 border-[#C1121F] bg-white px-3.5 py-3 shadow-sm">
          <div className="text-[12.5px] text-[#5C5456]">{P.balance}</div>
          <div
            className={`font-mono text-[28px] leading-tight font-bold ${owes ? "text-[#C1121F]" : "text-ok"}`}
          >
            {formatFC(d.balance.outstandingFc)}
          </div>
          <div className="text-[12.5px] text-[#5C5456]">
            {owes && lateSince
              ? `dont ${formatFC(d.balance.lateFc)} ${P.lateSince} ${formatDateFr(lateSince)}`
              : nextDue
                ? `${P.nothingDue} ${formatDateFr(nextDue)}`
                : ""}
          </div>
        </div>
        <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3 text-[12.5px]">
          <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
            {P.entities}
          </p>
          {d.entities.map((e) => (
            <div key={e.entity.id} className="border-b border-[#EFEAEA] py-1.5 last:border-0">
              <b>{e.entity.name}</b>
              <div className="text-[#5C5456]">{e.categoryLabel}</div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3 text-[13px]">
          {[
            [P.phone, d.taxpayer.phone],
            [P.address, `${d.taxpayer.address}${d.quartier ? `, ${d.quartier}` : ""}`],
            [P.registeredOn, formatDateFr(d.taxpayer.registeredAt)],
          ].map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between gap-2 border-b border-[#EFEAEA] py-1.5 last:border-0"
            >
              <span className="text-[#5C5456]">{k}</span>
              <b className="text-right">{v}</b>
            </div>
          ))}
          <div className="mt-2.5">
            <ContactForm
              taxpayerNo={d.taxpayer.taxpayerNo}
              phone={d.taxpayer.phone}
              address={d.taxpayer.address}
            />
          </div>
        </div>
        <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3 text-[12.5px]">
          <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
            {P.history}
          </p>
          {d.payments.length === 0 ? (
            <div className="py-1.5 text-[#5C5456]">{P.noHistory}</div>
          ) : null}
          {d.payments.map(({ p }) => (
            <div
              key={p.id}
              className="flex justify-between border-b border-[#EFEAEA] py-1.5 last:border-0"
            >
              <span>
                {formatDateFr(p.createdAt)} · {t.status.channel[p.channel]}
              </span>
              <b className={`font-mono ${p.status === "confirmed" ? "" : "text-bad"}`}>
                {p.status === "confirmed" ? formatFC(p.amountFc) : P.failed}
              </b>
            </div>
          ))}
        </div>
        <div className="mt-auto">
          {owes ? (
            <Link
              href={`/agent/encaisser/${d.taxpayer.taxpayerNo}` as never}
              className="block min-h-12 rounded-lg bg-[#C1121F] px-3.5 py-3 text-center text-[15px] font-semibold text-white"
            >
              {P.collect} {formatFC(d.balance.outstandingFc)}
            </Link>
          ) : (
            <div className="min-h-12 rounded-lg border border-[#D5CFCF] bg-white px-3.5 py-3 text-center text-[15px] font-semibold opacity-50">
              {P.nothingToCollect}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
