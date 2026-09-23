import Link from "next/link";
import { asc, eq } from "drizzle-orm";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listTaxpayers } from "@/lib/admin/taxpayers";
import { getDb } from "@/lib/db/client";
import { zones } from "@/lib/db/schema";
import { canEditTaxpayer } from "@/lib/identity/roles";
import { requireAdmin } from "@/lib/identity/session";
import { formatFC } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";

import { Pill } from "../../_components/pill";

const tone = { paid: "ok", due: "warn", late: "bad" } as const;

// Below md the filters stack in a two-column grid with ≥44 px controls; from md on they form the
// single row of the prototype (the search box flexes on tablets so the row never wraps).
const selectClass =
  "h-11 w-full min-w-0 rounded-md border border-[#D5CFCF] bg-white px-2 max-md:text-base md:h-8 md:w-auto";
// Cells: taller rows on phones so the identifier link is a comfortable tap target.
const cell = "px-2.5 py-3.5 md:py-2";
// The identifier column stays visible while the table scrolls sideways below the desktop width.
const stickyCell =
  "max-xl:sticky max-xl:left-0 max-xl:z-[1] max-xl:bg-white max-xl:shadow-[inset_-1px_0_0_#EFEAEA] max-xl:group-hover:bg-[#FFF6F6]";

export default async function TaxpayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; commune?: string; statut?: string; page?: string }>;
}) {
  const [sp, session] = await Promise.all([searchParams, requireAdmin()]);
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
        {canEditTaxpayer(session.role) ? (
          <Link
            href="/admin/contribuables/nouveau"
            className="inline-flex h-11 items-center rounded-md bg-[#C1121F] px-3 text-[12.5px] font-semibold text-white md:h-8"
          >
            + {t.admin.taxpayers.create.button}
          </Link>
        ) : null}
        <form
          className="ml-auto grid w-full grid-cols-2 gap-2 text-[12px] md:flex md:w-auto md:flex-wrap md:items-center md:gap-1.5"
          method="get"
        >
          <Input
            name="q"
            placeholder={`🔍 ${t.admin.taxpayers.searchPlaceholder}`}
            defaultValue={sp.q ?? ""}
            className="col-span-2 h-11 md:h-8 md:flex-1 lg:w-56 lg:flex-none"
          />
          <select name="commune" defaultValue={sp.commune ?? ""} className={selectClass}>
            <option value="">
              {t.admin.taxpayers.commune} : {t.common.all}
            </option>
            {communes.map((z) => (
              <option key={z.code} value={z.code}>
                {z.name}
              </option>
            ))}
          </select>
          <select name="statut" defaultValue={sp.statut ?? ""} className={selectClass}>
            <option value="">
              {t.admin.taxpayers.status} : {t.common.all}
            </option>
            <option value="paid">{t.status.pill.paid}</option>
            <option value="due">{t.status.pill.due}</option>
            <option value="late">{t.status.pill.late}</option>
          </select>
          <Button type="submit" size="sm" variant="outline" className="col-span-2 h-11 md:h-7">
            {t.common.search}
          </Button>
        </form>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[#E3DEDE] bg-white">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] tracking-wider text-[#5C5456] uppercase">
              {[c.id, c.name, c.type, c.quartier, c.phone].map((h, i) => (
                <th
                  key={h}
                  className={`border-b border-[#D5CFCF] px-2.5 py-2 font-semibold whitespace-nowrap ${i === 0 ? stickyCell : ""}`}
                >
                  {h}
                </th>
              ))}
              <th className="border-b border-[#D5CFCF] px-2.5 py-2 text-right font-semibold whitespace-nowrap">
                {c.due}
              </th>
              <th className="border-b border-[#D5CFCF] px-2.5 py-2 text-right font-semibold whitespace-nowrap">
                {c.paid}
              </th>
              <th className="border-b border-[#D5CFCF] px-2.5 py-2 font-semibold whitespace-nowrap">
                {c.status}
              </th>
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
              <tr key={r.taxpayerNo} className="group border-b border-[#EFEAEA] hover:bg-[#FFF6F6]">
                <td className={`${cell} font-mono whitespace-nowrap ${stickyCell}`}>
                  <Link
                    href={`/admin/contribuables/${r.taxpayerNo}` as never}
                    className="text-[#C1121F] underline-offset-2 hover:underline max-md:-my-3.5 max-md:block max-md:py-3.5"
                  >
                    {r.taxpayerNo}
                  </Link>
                </td>
                <td className={`${cell} min-w-32`}>{r.fullName}</td>
                <td className={cell}>{r.categoryLabel ?? t.common.none}</td>
                <td className={cell}>{r.quartier ?? t.common.none}</td>
                <td className={`${cell} font-mono`}>{r.phone}</td>
                <td className={`${cell} text-right font-mono whitespace-nowrap`}>
                  {formatFC(r.balance.issuedFc)}
                </td>
                <td className={`${cell} text-right font-mono whitespace-nowrap`}>
                  {formatFC(r.balance.paidFc)}
                </td>
                <td className={cell}>
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
