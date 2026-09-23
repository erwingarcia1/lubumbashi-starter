import { and, eq, isNull } from "drizzle-orm";

import { actorOf, deviceOf, whereOf, type RequestContext } from "@/lib/admin/context";
import { AdminError } from "@/lib/admin/errors";
import { writeAudit } from "@/lib/audit/write";
import type { Db } from "@/lib/db/client";
import { obligations } from "@/lib/db/schema";
import { canIssueInvoice } from "@/lib/identity/roles";
import type { AdminSession } from "@/lib/identity/session";
import type { Period } from "@/lib/time";

import { NOTE_TEMPLATE_VERSION } from "./pdf";
import {
  ISSUABLE_STATUSES,
  loadInvoiceSnapshot,
  loadInvoiceSnapshotsForPeriod,
  printRunWhere,
  type InvoiceRef,
  type InvoiceSnapshot,
} from "./snapshot";

export interface IssuedInvoice {
  snapshot: InvoiceSnapshot;
  /** True when this call stamped the first issue; false for a re-print. */
  firstIssue: boolean;
}

/**
 * Issues the note de perception of one obligation for a Mairie user (Finances, Administrateur,
 * Superviseur). The first issue stamps `invoice_issued_at/_by` and writes `invoice.issued`
 * (WHO = the admin, WHERE = IP, DEVICE = user agent); later calls re-print without touching
 * the stamp or the journal. A note is only issued for an open obligation; an issued note stays
 * re-printable whatever the obligation became (settled notes carry a "réglée" stamp).
 */
export async function issueInvoice(
  db: Db,
  session: AdminSession,
  ref: InvoiceRef,
  ctx: RequestContext = {},
  now = new Date(),
): Promise<IssuedInvoice> {
  if (!canIssueInvoice(session.role)) throw new AdminError("forbidden");
  return db.transaction(async (tx) => {
    const snapshot = await loadInvoiceSnapshot(tx, ref, now);
    if (!snapshot) throw new AdminError("not_found", JSON.stringify(ref));
    if (snapshot.issuedAt) return { snapshot, firstIssue: false };
    if (!(ISSUABLE_STATUSES as readonly string[]).includes(snapshot.status)) {
      throw new AdminError("invalid_state", snapshot.status);
    }
    // The WHERE clause makes a concurrent first issue lose gracefully: no second stamp, no second audit row.
    const stamped = await tx
      .update(obligations)
      .set({ invoiceIssuedAt: now, invoiceIssuedByAdminId: session.adminId, updatedAt: now })
      .where(and(eq(obligations.id, snapshot.obligationId), isNull(obligations.invoiceIssuedAt)))
      .returning({ id: obligations.id });
    if (stamped.length === 0) {
      const reloaded = await loadInvoiceSnapshot(tx, ref, now);
      return { snapshot: reloaded ?? snapshot, firstIssue: false };
    }
    await writeAudit(tx, {
      actor: actorOf(session),
      action: "invoice.issued",
      object: { type: "obligation", id: snapshot.invoiceNo },
      details: {
        obligationId: snapshot.obligationId,
        taxpayerNo: snapshot.taxpayer.taxpayerNo,
        amountFc: snapshot.amountFc,
        penaltyFc: snapshot.penaltyFc,
        outstandingFc: snapshot.outstandingFc,
        templateVersion: NOTE_TEMPLATE_VERSION,
      },
      where: whereOf(ctx),
      device: deviceOf(ctx),
    });
    return {
      snapshot: {
        ...snapshot,
        issuedAt: now.toISOString(),
        issuedBy: session.fullName,
        issuedBySystem: false,
      },
      firstIssue: true,
    };
  });
}

/**
 * Print run of the report "invoices": every open obligation whose period starts in `period`.
 * Finances prints the batch to serve the notes, so the run IS the first issue of every note not
 * issued yet: they are stamped with a system actor (`invoice_issued_by_admin_id` null) and each
 * gets an `invoice.issued` audit row with `details.batch`; a later single print keeps that date.
 */
export async function issueInvoiceBatch(
  db: Db,
  period: Period,
  month: string,
  now = new Date(),
): Promise<InvoiceSnapshot[]> {
  await db.transaction(async (tx) => {
    const stamped = await tx
      .update(obligations)
      .set({ invoiceIssuedAt: now, invoiceIssuedByAdminId: null, updatedAt: now })
      .where(and(printRunWhere(period), isNull(obligations.invoiceIssuedAt)))
      .returning({ id: obligations.id, invoiceNo: obligations.invoiceNo });
    for (const o of stamped) {
      await writeAudit(tx, {
        actor: { type: "system" },
        action: "invoice.issued",
        object: { type: "obligation", id: o.invoiceNo ?? o.id },
        details: { batch: month, obligationId: o.id, templateVersion: NOTE_TEMPLATE_VERSION },
      });
    }
  });
  return loadInvoiceSnapshotsForPeriod(db, period, now);
}
