import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { auditLog, notifications, obligations, portalLinks, taxpayers } from "@/lib/db/schema";
import { processNotificationQueue, renderNotification } from "@/lib/notify";
import type { NotifyProvider, OutboundMessage } from "@/lib/notify/provider";
import { applyProviderResult, initiatePayment } from "@/lib/payments/service";
import { fileComplaint } from "@/lib/portal/complaints";
import { findInvoice } from "@/lib/portal/invoice";
import { issuePortalLink, resolvePortalLink, revokePortalLinks } from "@/lib/portal/links";
import { runSeed } from "@/scripts/seed";

import { appDb } from "./db";

/** Fresh obligations in a random far-future year: confirmations are append-only. */
const YEAR = 2100 + Math.floor(Math.random() * 800);
let taxpayer: typeof taxpayers.$inferSelect;
let template: typeof obligations.$inferSelect;
/** A second household: two avis in the same month must come from two entities (unique period per entity). */
let other: typeof obligations.$inferSelect;

function fakeProvider(sent: OutboundMessage[]): NotifyProvider {
  return {
    name: "console",
    async send(m) {
      sent.push(m);
      return { ok: true, providerMessageId: `fake-${m.reference}` };
    },
  };
}

describe("portal: signed links, self-service payment, complaints, avis (M7)", () => {
  beforeAll(async () => {
    const db = appDb();
    await runSeed(db);
    taxpayer = (
      await db.select().from(taxpayers).where(eq(taxpayers.taxpayerNo, "LUB-KAM-00000127"))
    )[0]!;
    template = (
      await db.select().from(obligations).where(eq(obligations.taxpayerId, taxpayer.id)).limit(1)
    )[0]!;
    const [otherTp] = await db
      .select({ id: taxpayers.id })
      .from(taxpayers)
      .where(eq(taxpayers.taxpayerNo, "LUB-KAM-00000129"));
    other = (
      await db.select().from(obligations).where(eq(obligations.taxpayerId, otherTp!.id)).limit(1)
    )[0]!;
    // Start from a clean outbox so the send test is deterministic.
    await db
      .update(notifications)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(notifications.status, "queued"));
  });

  it("a link resolves to its taxpayer once, then not after expiry or revocation", async () => {
    const db = appDb();
    const now = new Date();
    const { token, url } = await issuePortalLink(db, taxpayer.id, now, 30);
    expect(url).toContain(`/t/${token}`);
    const [row] = await db
      .select()
      .from(portalLinks)
      .where(eq(portalLinks.taxpayerId, taxpayer.id))
      .limit(1);
    expect(row!.tokenHash).not.toBe(token); // only the hash is stored
    expect((await resolvePortalLink(db, token, now))?.taxpayerNo).toBe("LUB-KAM-00000127");
    expect(
      await resolvePortalLink(db, token, new Date(now.getTime() + 31 * 86_400_000)),
    ).toBeNull();
    expect(await resolvePortalLink(db, "not-a-token", now)).toBeNull();
    await revokePortalLinks(db, taxpayer.id, now);
    expect(await resolvePortalLink(db, token, now)).toBeNull();
  });

  it("every obligation gets an avis number AV-YYMM-NNNNNN and a QR token from the database", async () => {
    const db = appDb();
    const yymm = `${String(YEAR % 100).padStart(2, "0")}03`;
    const rows = await db
      .insert(obligations)
      .values(
        [template, other].map((tpl, i) => ({
          entityId: tpl.entityId,
          taxpayerId: tpl.taxpayerId,
          taxRuleId: tpl.taxRuleId,
          taxRuleVersionId: tpl.taxRuleVersionId,
          periodStart: `${YEAR}-03-01`,
          periodEnd: `${YEAR}-03-28`,
          dueDate: `${YEAR}-03-2${i + 1}`,
          amountFc: 1000 * (i + 1),
        })),
      )
      .returning();
    for (const r of rows) {
      expect(r.invoiceNo).toMatch(new RegExp(`^AV-${yymm}-\\d{6}$`));
      expect(r.invoiceToken).toMatch(/^[0-9a-f]{32}$/);
    }
    const [a, b] = rows.map((r) => Number(r.invoiceNo!.slice(-6)));
    expect(b).toBe(a! + 1);
    const inv = await findInvoice(db, rows[0]!.invoiceNo!, rows[0]!.invoiceToken!);
    expect(inv?.taxpayer.taxpayerNo).toBe("LUB-KAM-00000127");
    expect(await findInvoice(db, rows[0]!.invoiceNo!, "wrong")).toBeNull();
    await db
      .update(obligations)
      .set({ status: "cancelled", cancelledReason: "test" })
      .where(
        inArray(
          obligations.id,
          rows.map((r) => r.id),
        ),
      );
  });

  it("a taxpayer pays one selected obligation from the portal; the receipt SMS goes out once", async () => {
    const db = appDb();
    const [o] = await db
      .insert(obligations)
      .values({
        entityId: template.entityId,
        taxpayerId: taxpayer.id,
        taxRuleId: template.taxRuleId,
        taxRuleVersionId: template.taxRuleVersionId,
        periodStart: `${YEAR}-05-01`,
        periodEnd: `${YEAR}-05-28`,
        dueDate: `${YEAR}-05-28`,
        amountFc: 7000,
      })
      .returning();
    const view = await initiatePayment(
      db,
      {
        type: "taxpayer",
        taxpayerId: taxpayer.id,
        taxpayerNo: taxpayer.taxpayerNo,
        ip: "10.0.0.1",
        userAgent: "test",
      },
      { taxpayerNo: taxpayer.taxpayerNo, channel: "mpesa", obligationIds: [o!.id] },
    );
    expect(view.amountFc).toBe(7000);
    expect(view.status).toBe("pending");
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "payment.initiated"), eq(auditLog.objectId, view.reference)));
    expect(audit!.actorType).toBe("taxpayer");
    expect(audit!.ip).toBe("10.0.0.1");

    await applyProviderResult(
      db,
      view.reference,
      {
        status: "confirmed",
        providerReference: `PORTAL-${view.reference}`,
        amountFc: 7000,
        raw: {},
      },
      "callback",
    );
    const [paid] = await db.select().from(obligations).where(eq(obligations.id, o!.id));
    expect(paid!.status).toBe("paid");

    const sent: OutboundMessage[] = [];
    const first = await processNotificationQueue(db, fakeProvider(sent));
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const receiptSms = sent.find((m) => m.body.includes("/v/RCP-"));
    expect(receiptSms?.to).toBe(taxpayer.phone);
    expect(receiptSms?.body).toContain("7 000 FC");
    const again = await processNotificationQueue(db, fakeProvider(sent));
    expect(again.sent).toBe(0);
    const [n] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.providerMessageId, `fake-${receiptSms!.reference}`));
    expect(n!.status).toBe("sent");
    expect(renderNotification(n!)).toBe(receiptSms!.body);
  });

  it("a complaint is stored with its category and audited as the taxpayer", async () => {
    const db = appDb();
    const row = await fileComplaint(
      db,
      taxpayer,
      {
        categoryCode: "dechets_non_collectes",
        description: "Pas de collecte depuis deux semaines.",
        phone: "+243972045561",
      },
      { ip: "10.0.0.2", userAgent: "test" },
    );
    expect(row.status).toBe("open");
    expect(row.categoryLabelFr).toBe("Les déchets ne sont pas collectés");
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "complaint.filed"), eq(auditLog.objectId, row.id)));
    expect(audit!.actorType).toBe("taxpayer");
    await expect(
      fileComplaint(db, taxpayer, {
        categoryCode: "nope",
        description: "xxxxx",
        phone: "+243972045561",
      }),
    ).rejects.toThrow(/unknown_category/);
  });
});
