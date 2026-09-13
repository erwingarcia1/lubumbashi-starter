import { t } from "@/lib/i18n";

import { PortalHeader } from "../../_components/portal-header";

export default function PortalExpiredPage() {
  const E = t.portal.expire;
  return (
    <>
      <PortalHeader title={t.receipt.city} subtitle={t.portal.brand} />
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <div className="border-bad bg-bad-soft rounded-lg border p-3.5">
          <div className="text-bad text-[16px] font-bold">{E.title}</div>
          <p className="mt-1 text-[12.5px] text-[#5C5456]">{E.body}</p>
        </div>
      </div>
    </>
  );
}
