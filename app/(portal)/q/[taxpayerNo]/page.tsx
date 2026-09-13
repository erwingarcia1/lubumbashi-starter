import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { taxpayers } from "@/lib/db/schema";
import { t } from "@/lib/i18n";

import { PortalHeader } from "../../_components/portal-header";
import { RequestLink } from "./request-link";

export const dynamic = "force-dynamic";

/**
 * What the door sticker's QR opens (public). The QR only identifies the property; the balance
 * is visible only through the personal link sent by SMS (a removed or swapped sticker changes nothing).
 */
export default async function StickerLandingPage({
  params,
}: {
  params: Promise<{ taxpayerNo: string }>;
}) {
  const { taxpayerNo } = await params;
  const [tp] = /^LUB-[A-Z]{3}-\d{8}$/.test(taxpayerNo)
    ? await getDb()
        .select({ taxpayerNo: taxpayers.taxpayerNo })
        .from(taxpayers)
        .where(and(eq(taxpayers.taxpayerNo, taxpayerNo), eq(taxpayers.status, "active")))
    : [];
  const S = t.portal.sticker;
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-[#F6F5F2] text-[#1B1B1F]">
      <PortalHeader title={t.receipt.city} subtitle={t.portal.brand} />
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <div className="rounded-lg border border-[#E3DEDE] bg-white p-3.5">
          <div className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
            {S.title}
          </div>
          <div className="font-mono text-[20px] font-bold">{taxpayerNo}</div>
          <p className="mt-2 text-[12.5px] text-[#5C5456]">{S.body}</p>
        </div>
        {tp ? (
          <RequestLink taxpayerNo={tp.taxpayerNo} />
        ) : (
          <div className="border-bad bg-bad-soft rounded-lg border p-3.5">
            <div className="text-bad text-[16px] font-bold">{S.unknown}</div>
            <p className="text-[12.5px] text-[#5C5456]">{S.unknownBody}</p>
          </div>
        )}
      </div>
    </div>
  );
}
