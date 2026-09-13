import Link from "next/link";

import { getDb } from "@/lib/db/client";
import { listRules } from "@/lib/admin/taxes";
import { formatDateFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";

import { Pill } from "../../_components/pill";
import { calcText, penaltyText } from "../../_components/tax-format";

export default async function TaxesPage() {
  const rules = await listRules(getDb());
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">{t.admin.taxes.title}</h2>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[#E3DEDE] bg-white">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] tracking-wider text-[#5C5456] uppercase">
              {[
                t.admin.taxes.columns.tax,
                t.admin.taxes.columns.category,
                t.admin.taxes.columns.calc,
                t.admin.taxes.columns.frequency,
                t.admin.taxes.columns.penalty,
                t.admin.taxes.columns.effective,
                t.admin.taxes.columns.status,
              ].map((h) => (
                <th key={h} className="border-b border-[#D5CFCF] px-2.5 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => {
              const v = r.current ?? r.upcoming;
              return (
                <tr key={r.id} className="border-b border-[#EFEAEA] hover:bg-[#FFF6F6]">
                  <td className="px-2.5 py-2">
                    <Link
                      href={`/admin/taxes/${r.code}` as never}
                      className="font-semibold text-[#C1121F] underline-offset-2 hover:underline"
                    >
                      {r.labelFr}
                    </Link>
                  </td>
                  <td className="px-2.5 py-2">{r.categoryLabel}</td>
                  <td className="px-2.5 py-2 font-mono">{calcText(v)}</td>
                  <td className="px-2.5 py-2">
                    {v ? t.admin.taxes.frequencyLabels[v.frequency] : t.common.none}
                  </td>
                  <td className="px-2.5 py-2">{penaltyText(v)}</td>
                  <td className="px-2.5 py-2">
                    {r.current
                      ? formatDateFr(r.current.effectiveFrom)
                      : r.upcoming
                        ? formatDateFr(r.upcoming.effectiveFrom)
                        : t.common.none}
                  </td>
                  <td className="px-2.5 py-2">
                    {r.current ? (
                      <Pill tone="ok">{t.status.version.approved}</Pill>
                    ) : r.upcoming ? (
                      <Pill tone="warn">{t.status.version.upcoming}</Pill>
                    ) : (
                      <Pill tone="n">{t.status.version.draft}</Pill>
                    )}
                    {r.draftCount > 0 ? (
                      <span className="ml-2 text-[11px] text-[#5C5456]">
                        {r.draftCount} {t.admin.taxes.drafts}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
