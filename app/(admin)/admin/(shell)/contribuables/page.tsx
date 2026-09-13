import Link from "next/link";
import { asc, eq } from "drizzle-orm";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listTaxpayers } from "@/lib/admin/taxpayers";
import { getDb } from "@/lib/db/client";
import { zones } from "@/lib/db/schema";
import { formatFC } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";

import { Pill } from "../../_components/pill";

const tone = { paid: "ok", due: "warn", late: "bad" } as const;

export default async function TaxpayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; commune?: string; statut?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const db = getDb();
  const communes = await db
    .select({ code: zones.code, name: zones.name })
    .from(zones)
    .where(eq(zones.level, "commune"))
    .orderBy(asc(zones.name));
  const pill =
    sp.statut === "paid" || sp.statut === "due" || sp.statut === "late" ? sp.statut : undefined;
  const { items, total, page, pageSize } = await listTaxpayers(db, {
    q: sp.q,
    communeCode: sp.commune,
    pill,
    page: Number(sp.page ?? 1),
  });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const c = t.admin.taxpayers.columns;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">{t.admin.taxpayers.title}</h2>
        <form className="ml-auto flex flex-wrap items-center gap-1.5 text-[12px]" method="get">
          <Input
            name="q"
            placeholder={`🔍 ${t.admin.taxpayers.searchPlaceholder}`}
            defaultValue={sp.q ?? ""}
            className="h-8 w-56"
          />
          <select
            name="commune"
            defaultValue={sp.commune ?? ""}
            className="h-8 rounded-md border border-[#D5CFCF] bg-white px-2"
          >
            <option value="">
              {t.admin.taxpayers.commune} : {t.common.all}
            </option>
            {communes.map((z) => (
              <option key={z.code} value={z.code}>
                {z.name}
              </option>
            ))}
          </select>
          <select
            name="statut"
            defaultValue={sp.statut ?? ""}
            className="h-8 rounded-md border border-[#D5CFCF] bg-white px-2"
          >
            <option value="">
              {t.admin.taxpayers.status} : {t.common.all}
            </option>
            <option value="paid">{t.status.pill.paid}</option>
            <option value="due">{t.status.pill.due}</option>
            <option value="late">{t.status.pill.late}</option>
          </select>
          <Button type="submit" size="sm" variant="outline">
            {t.common.search}
          </Button>
        </form>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[#E3DEDE] bg-white">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] tracking-wider text-[#5C5456] uppercase">
              {[c.id, c.name, c.type, c.quartier, c.phone].map((h) => (
                <th key={h} className="border-b border-[#D5CFCF] px-2.5 py-2 font-semibold">
                  {h}
                </th>
              ))}
              <th className="border-b border-[#D5CFCF] px-2.5 py-2 text-right font-semibold">
                {c.due}
              </th>
              <th className="border-b border-[#D5CFCF] px-2.5 py-2 text-right font-semibold">
                {c.paid}
              </th>
              <th className="border-b border-[#D5CFCF] px-2.5 py-2 font-semibold">{c.status}</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2.5 py-4 text-center text-[#5C5456]">
                  {t.admin.taxpayers.empty}
                </td>
              </tr>
            ) : null}
            {items.map((r) => (
              <tr key={r.taxpayerNo} className="border-b border-[#EFEAEA] hover:bg-[#FFF6F6]">
                <td className="px-2.5 py-2 font-mono">
                  <Link
                    href={`/admin/contribuables/${r.taxpayerNo}` as never}
                    className="text-[#C1121F] underline-offset-2 hover:underline"
                  >
                    {r.taxpayerNo}
                  </Link>
                </td>
                <td className="px-2.5 py-2">{r.fullName}</td>
                <td className="px-2.5 py-2">{r.categoryLabel ?? t.common.none}</td>
                <td className="px-2.5 py-2">{r.quartier ?? t.common.none}</td>
                <td className="px-2.5 py-2 font-mono">{r.phone}</td>
                <td className="px-2.5 py-2 text-right font-mono">{formatFC(r.balance.issuedFc)}</td>
                <td className="px-2.5 py-2 text-right font-mono">{formatFC(r.balance.paidFc)}</td>
                <td className="px-2.5 py-2">
                  <Pill tone={tone[r.balance.pill]}>{t.status.pill[r.balance.pill]}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12.5px] text-[#5C5456]">
        {total} {t.admin.taxpayers.count} · {t.admin.taxpayers.page} {page} / {pages} ·{" "}
        {t.admin.taxpayers.rowHint}
      </p>
    </>
  );
}
