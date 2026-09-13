import { and, asc, eq, lte, sql } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";
import { verifyUrlFor } from "@/lib/receipts/lookup";

import { portalUrlFor } from "@/lib/portal/links";

import type { NotifyProvider } from "./provider";
import { consoleProvider } from "./providers/console";
import { renderTemplate, type TemplateKey } from "./templates";

export function getNotifyProvider(env: NodeJS.ProcessEnv = process.env): NotifyProvider {
  const name = env.SMS_PROVIDER ?? "console";
  if (name === "console") return consoleProvider();
  // Real providers (Africa's Talking, WhatsApp Cloud API) arrive after DECISIONS D11-style answers.
  throw new Error(`SMS provider not implemented: ${name}`);
}

/** Renders one queued notification from its payload; unknown template keys are failures. */
export function renderNotification(n: { templateKey: string; payload: unknown }): string {
  const p = (n.payload ?? {}) as Record<string, unknown>;
  const key = n.templateKey as TemplateKey;
  switch (key) {
    case "registration":
      return renderTemplate("registration", {
        taxpayerNo: String(p.taxpayerNo ?? ""),
        fullName: String(p.fullName ?? ""),
        portalUrl: p.portalUrl ? String(p.portalUrl) : undefined,
      });
    case "portal_link":
      return renderTemplate("portal_link", {
        taxpayerNo: String(p.taxpayerNo ?? ""),
        portalUrl: String(p.portalUrl ?? ""),
      });
    case "payment_confirmed":
      return renderTemplate("payment_confirmed", {
        amountFc: Number(p.amountFc ?? 0),
        reference: String(p.reference ?? ""),
      });
    case "reminder":
      return renderTemplate("reminder", {
        amountFc: Number(p.amountFc ?? 0),
        dueDate: String(p.dueDate ?? ""),
        portalUrl: String(p.portalUrl ?? ""),
      });
    case "receipt":
      return renderTemplate("receipt", {
        receiptNo: String(p.receiptNo ?? ""),
        amountFc: Number(p.amountFc ?? 0),
        verifyUrl: p.verifyToken
          ? verifyUrlFor(String(p.receiptNo ?? ""), String(p.verifyToken))
          : String(p.verifyUrl ?? ""),
      });
    default:
      throw new Error(`unknown template ${n.templateKey}`);
  }
}

/**
 * Sends everything queued and due, one by one, marking each sent or failed. Idempotent: a
 * notification is sent at most once. Returns the counts.
 */
export async function processNotificationQueue(
  db: Db,
  provider: NotifyProvider = getNotifyProvider(),
  now?: Date,
  limit = 100,
): Promise<{ sent: number; failed: number }> {
  const due = await db
    .select()
    .from(notifications)
    // Due-ness is judged by the database clock unless a test pins `now` (the VM clock may drift).
    .where(
      and(
        eq(notifications.status, "queued"),
        now ? lte(notifications.scheduledAt, now) : lte(notifications.scheduledAt, sql`now()`),
      ),
    )
    .orderBy(asc(notifications.scheduledAt))
    .limit(limit);
  let sent = 0;
  let failed = 0;
  const sentAt = now ?? new Date();
  for (const n of due) {
    try {
      const body = renderNotification(n);
      const r = await provider.send({ to: n.to, body, reference: n.id });
      if (r.ok) {
        await db
          .update(notifications)
          .set({ status: "sent", sentAt, providerMessageId: r.providerMessageId ?? null })
          .where(and(eq(notifications.id, n.id), eq(notifications.status, "queued")));
        sent += 1;
      } else {
        await db
          .update(notifications)
          .set({ status: "failed", error: r.error ?? "send failed" })
          .where(eq(notifications.id, n.id));
        failed += 1;
      }
    } catch (err) {
      await db
        .update(notifications)
        .set({ status: "failed", error: String(err).slice(0, 500) })
        .where(eq(notifications.id, n.id));
      failed += 1;
    }
  }
  return { sent, failed };
}

export { portalUrlFor };
