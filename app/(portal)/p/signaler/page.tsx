import Link from "next/link";

import { getDb } from "@/lib/db/client";
import { formatDateFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { getPortalAccount } from "@/lib/portal/account";
import { listComplaintCategories } from "@/lib/portal/complaints";
import { requirePortalTaxpayer } from "@/lib/portal/session";
import { requestNow } from "@/lib/time";

import { PortalHeader } from "../../_components/portal-header";
import { ComplaintForm } from "./complaint-form";

export const dynamic = "force-dynamic";

/** Screen p-complaint: categories are data (incl. "Les déchets ne sont pas collectés"). */
export default async function PortalComplaintPage() {
  const taxpayer = await requirePortalTaxpayer();
  const db = getDb();
  const [categories, account] = await Promise.all([
    listComplaintCategories(db),
    getPortalAccount(db, taxpayer.id, requestNow()),
  ]);
  const C = t.portal.complaint;
  return (
    <>
      <PortalHeader title={C.title} subtitle={C.subtitle} />
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <ComplaintForm categories={categories} phone={account.taxpayer.phone} />
        <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-2">
          <div className="py-1.5 text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
            {C.mine}
          </div>
          {account.complaints.length === 0 ? (
            <p className="py-2 text-[12.5px] text-[#5C5456]">{t.common.none}</p>
          ) : (
            account.complaints.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-2 border-t border-[#EFEAEA] py-2 text-[12.5px]"
              >
                <span>
                  {formatDateFr(c.createdAt)} · {c.categoryLabelFr}
                </span>
                <b className={c.status === "resolved" ? "text-ok" : "text-[#5C5456]"}>
                  {C.statuses[c.status]}
                </b>
              </div>
            ))
          )}
        </div>
        <Link
          href="/p"
          className="block min-h-12 rounded-lg border border-[#D5CFCF] bg-white px-3.5 py-3 text-center text-[15px] font-semibold"
        >
          {t.portal.pay.back}
        </Link>
      </div>
    </>
  );
}
