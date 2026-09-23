import { and, eq, inArray, isNull } from "drizzle-orm";

import { actorOf, deviceOf, whereOf, type RequestContext } from "@/lib/admin/context";
import { AdminError } from "@/lib/admin/errors";
import { writeAudit } from "@/lib/audit/write";
import type { Db, Tx } from "@/lib/db/client";
import { obligations } from "@/lib/db/schema";
import { formatMonthFr } from "@/lib/i18n/format";
import { canIssueInvoice } from "@/lib/identity/roles";
import type { AdminSession } from "@/lib/identity/session";
import type { Period } from "@/lib/time";

import { NOTE_TEMPLATE_VERSION, renderInvoiceBatchPdf, renderInvoicePdf } from "./pdf";
import {
  ISSUABLE_STATUSES,
  loadInvoiceSnapshot,
  loadInvoiceSnapshotsForPeriod,
  withFirstIssue,
  type InvoiceRef,
  type InvoiceSnapshot,
} from "./snapshot";

export interface IssuedInvoice {
  snapshot: InvoiceSnapshot;
  /** True when this call stamped the first issue; false for a re-print. */
  firstIssue: boolean;
}

export interface IssuedInvoicePdf extends IssuedInvoice {
  /** Rendered from `snapshot` before any stamp was written: the buffer to serve. */
  pdf: Buffer;
}

export interface IssuedInvoiceBatch {
  snapshots: InvoiceSnapshot[];
  pdf: Buffer;
  /** Notes this run stamped for the first time; the others had been issued before. */
  firstIssues: number;
}

function isIssuable(snapshot: InvoiceSnapshot): boolean {
  return (ISSUABLE_STATUSES as readonly string[]).includes(snapshot.status);
}

/** What every `invoice.issued` row records about the note as printed (integers of FC). */
function issuedDetails(s: InvoiceSnapshot, batch?: string) {
  return {
    ...(batch === undefined ? {} : { batch }),
    obligationId: s.obligationId,
    taxpayerNo: s.taxpayer.taxpayerNo,
    amountFc: s.amountFc,
    penaltyFc: s.penaltyFc,
    outstandingFc: s.outstandingFc,
    templateVersion: NOTE_TEMPLATE_VERSION,
  };
}

/**
 * Guarded first-issue stamp of one note plus its audit row, in the caller's transaction. The
 * `invoice_issued_at IS NULL` guard makes a concurrent first issue lose gracefully: no second
 * stamp, no second audit row. Returns false when the note was issued in the meantime.
 */
async function stampFirstIssue(
  tx: Tx,
  snapshot: InvoiceSnapshot,
  session: AdminSession,
  ctx: RequestContext,
  now: Date,
): Promise<boolean> {
  const stamped = await tx
    .update(obligations)
    .set({ invoiceIssuedAt: now, invoiceIssuedByAdminId: session.adminId, updatedAt: now })
    .where(and(eq(obligations.id, snapshot.obligationId), isNull(obligations.invoiceIssuedAt)))
    .returning({ id: obligations.id });
  if (stamped.length === 0) return false;
  await writeAudit(tx, {
    actor: actorOf(session),
    action: "invoice.issued",
    object: { type: "obligation", id: snapshot.invoiceNo },
    details: issuedDetails(snapshot),
    where: whereOf(ctx),
    device: deviceOf(ctx),
  });
  return true;
}

/**
 * Issues the note de perception of one obligation for a Mairie user (Finances, Administrateur,
 * Superviseur) without rendering it: the first call stamps `invoice_issued_at/_by` and writes
 * `invoice.issued` (WHO = the admin, WHERE = IP, DEVICE = user agent); later calls re-print
 * without touching the stamp or the journal. A note is only issued for an open obligation; an
 * issued note stays re-printable whatever the obligation became (settled notes carry a
 * "réglée" stamp). Callers that serve the PDF use `issueInvoicePdf`, which renders first.
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
    if (!isIssuable(snapshot)) throw new AdminError("invalid_state", snapshot.status);
    if (!(await stampFirstIssue(tx, snapshot, session, ctx, now))) {
      const reloaded = await loadInvoiceSnapshot(tx, ref, now);
      return { snapshot: reloaded ?? snapshot, firstIssue: false };
    }
    return { snapshot: withFirstIssue(snapshot, session.fullName, now), firstIssue: true };
  });
}

/**
 * The note as a PDF, issued on its first print. The order matters: the note is RENDERED FIRST,
 * from the snapshot as it will read once stamped (issued now, by this admin), and only then
 * stamped and journaled in a short transaction. A render failure therefore leaves the note
 * unissued, and the buffer served is the one that was rendered. If another user issued the note
 * between the load and the stamp, the stored snapshot is reloaded and re-rendered so the print
 * shows the real first issue.
 */
export async function issueInvoicePdf(
  db: Db,
  session: AdminSession,
  ref: InvoiceRef,
  ctx: RequestContext = {},
  now = new Date(),
): Promise<IssuedInvoicePdf> {
  if (!canIssueInvoice(session.role)) throw new AdminError("forbidden");
  const stored = await loadInvoiceSnapshot(db, ref, now);
  if (!stored) throw new AdminError("not_found", JSON.stringify(ref));
  if (stored.issuedAt) {
    return { snapshot: stored, pdf: await renderInvoicePdf(stored), firstIssue: false };
  }
  if (!isIssuable(stored)) throw new AdminError("invalid_state", stored.status);
  const prospective = withFirstIssue(stored, session.fullName, now);
  const pdf = await renderInvoicePdf(prospective);
  const stamped = await db.transaction((tx) => stampFirstIssue(tx, stored, session, ctx, now));
  if (stamped) return { snapshot: prospective, pdf, firstIssue: true };
  const reloaded = (await loadInvoiceSnapshot(db, ref, now)) ?? stored;
  return { snapshot: reloaded, pdf: await renderInvoicePdf(reloaded), firstIssue: false };
}

/**
 * Print run of the report "invoices": every open obligation whose period starts in `period`,
 * one page each, in taxpayer order. Printing the batch IS the first issue of every note not
 * issued yet, so the run is done in the name of the Mairie user who asked for it: each stamp
 * carries `session.adminId` and each `invoice.issued` row her identity, IP and user agent, with
 * `details.batch` = the month; a later single print keeps that date. Only a job may pass a null
 * session, in which case the notes are issued by the system actor (`invoice_issued_by_admin_id`
 * null). Same order as the single note: load, render, then stamp and journal.
 */
export async function issueInvoiceBatch(
  db: Db,
  period: Period,
  month: string,
  session: AdminSession | null,
  ctx: RequestContext = {},
  now = new Date(),
): Promise<IssuedInvoiceBatch> {
  if (session && !canIssueInvoice(session.role)) throw new AdminError("forbidden");
  const monthLabel = formatMonthFr(`${month}-01`);
  const stored = await loadInvoiceSnapshotsForPeriod(db, period, now);
  const issuedBy = session?.fullName ?? null;
  const toStamp = stored.filter((s) => !s.issuedAt);
  const prospective = stored.map((s) => (s.issuedAt ? s : withFirstIssue(s, issuedBy, now)));
  const pdf = await renderInvoiceBatchPdf(prospective, monthLabel);
  if (toStamp.length === 0) return { snapshots: prospective, pdf, firstIssues: 0 };
  const stampedIds = await db.transaction(async (tx) => {
    const rows = await tx
      .update(obligations)
      .set({
        invoiceIssuedAt: now,
        invoiceIssuedByAdminId: session?.adminId ?? null,
        updatedAt: now,
      })
      .where(
        and(
          inArray(
            obligations.id,
            toStamp.map((s) => s.obligationId),
          ),
          isNull(obligations.invoiceIssuedAt),
        ),
      )
      .returning({ id: obligations.id });
    const ids = new Set(rows.map((r) => r.id));
    for (const s of toStamp) {
      if (!ids.has(s.obligationId)) continue;
      await writeAudit(tx, {
        actor: session ? actorOf(session) : { type: "system" as const },
        action: "invoice.issued",
        object: { type: "obligation", id: s.invoiceNo },
        details: issuedDetails(s, month),
        where: whereOf(ctx),
        device: deviceOf(ctx),
      });
    }
    return ids;
  });
  if (stampedIds.size === toStamp.length) {
    return { snapshots: prospective, pdf, firstIssues: toStamp.length };
  }
  // A concurrent first issue took some of the notes: print what is actually recorded.
  const reloaded = await loadInvoiceSnapshotsForPeriod(db, period, now);
  return {
    snapshots: reloaded,
    pdf: await renderInvoiceBatchPdf(reloaded, monthLabel),
    firstIssues: stampedIds.size,
  };
}
