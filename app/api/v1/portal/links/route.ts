import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";

import { fail, ok, parseBody, requestContext } from "@/lib/api/respond";
import { writeAudit } from "@/lib/audit/write";
import { getDb } from "@/lib/db/client";
import { notifications, portalLinks, taxpayers } from "@/lib/db/schema";
import { flushNotificationsSoon } from "@/lib/notify/flush";
import { issuePortalLink } from "@/lib/portal/links";

const body = z.strictObject({ taxpayerNo: z.string().regex(/^LUB-[A-Z]{3}-\d{8}$/) });
const COOLDOWN_MINUTES = 10;

/**
 * "Recevoir mon lien par SMS" from a door sticker (/q/<id>): a fresh signed link goes to the
 * phone on file, never to the requester. One request per taxpayer per 10 minutes.
 */
export async function POST(request: Request) {
  const parsed = await parseBody(request, body);
  if ("error" in parsed) return parsed.error;
  const db = getDb();
  const now = new Date();
  const [tp] = await db
    .select({ id: taxpayers.id, taxpayerNo: taxpayers.taxpayerNo, phone: taxpayers.phone })
    .from(taxpayers)
    .where(and(eq(taxpayers.taxpayerNo, parsed.data.taxpayerNo), eq(taxpayers.status, "active")));
  if (!tp) return fail("not_found", 404);
  const [recent] = await db
    .select({ id: portalLinks.id })
    .from(portalLinks)
    .where(
      and(
        eq(portalLinks.taxpayerId, tp.id),
        eq(portalLinks.purpose, "sms_request"),
        gt(portalLinks.createdAt, new Date(now.getTime() - COOLDOWN_MINUTES * 60_000)),
      ),
    )
    .orderBy(desc(portalLinks.createdAt))
    .limit(1);
  if (recent) return fail("too_many_requests", 429);

  const ctx = requestContext(request);
  await db.transaction(async (tx) => {
    const link = await issuePortalLink(tx, tp.id, now, undefined, "sms_request");
    await tx.insert(notifications).values({
      taxpayerId: tp.id,
      kind: "registration",
      channel: "sms",
      to: tp.phone,
      templateKey: "portal_link",
      payload: { taxpayerNo: tp.taxpayerNo, portalUrl: link.url },
    });
    await writeAudit(tx, {
      actor: { type: "taxpayer", id: tp.id, label: tp.taxpayerNo },
      action: "portal_link.requested",
      object: { type: "taxpayer", id: tp.taxpayerNo },
      details: { purpose: "sms_request" },
      where: ctx.ip ? { ip: ctx.ip } : undefined,
      device: ctx.userAgent ? { userAgent: ctx.userAgent } : undefined,
    });
  });
  flushNotificationsSoon();
  return ok({ sent: true, phoneMasked: `${tp.phone.slice(0, 7)}•••${tp.phone.slice(-4)}` });
}
