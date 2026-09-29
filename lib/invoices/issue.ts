import { and, inArray, isNull } from "drizzle-orm";

import { actorOf, deviceOf, whereOf, type RequestContext } from "@/lib/admin/context";
import { AdminError } from "@/lib/admin/errors";
import { writeAudit } from "@/lib/audit/write";
import type { Db, Tx } from "@/lib/db/client";
import { obligations } from "@/lib/db/schema";
import { formatMonthFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { canIssueInvoice } from "@/lib/identity/roles";
import type { AdminSession } from "@/lib/identity/session";
import type { Period } from "@/lib/time";

import { NOTE_TEMPLATE_VERSION, renderInvoiceBatchPdf, renderInvoicePdf } from "./pdf";
import {
  ISSUABLE_STATUSES,
  loadInvoiceSnapshot,
  loadInvoiceSnapshotsForObligations,
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

/** The taxpayer number every note belongs to, or null when the notes span several taxpayers. */
export function singleTaxpayerOf(snapshots: readonly InvoiceSnapshot[]): string | null {
  const first = snapshots[0]?.taxpayer.taxpayerNo ?? null;
  return first !== null && snapshots.every((s) => s.taxpayer.taxpayerNo === first) ? first : null;
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
 * Guarded first-issue stamp of several notes plus one audit row each, in the caller's
 * transaction. The `invoice_issued_at IS NULL` guard makes a concurrent first issue lose
 * gracefully: no second stamp, no second audit row. Returns the ids stamped by THIS call. A null
 * session is the system actor of a job (`invoice_issued_by_admin_id` null); `batch` (the month of
 * a print run) goes into the audit details when given.
 */
async function stampFirstIssues(
  tx: Tx,
  toStamp: readonly InvoiceSnapshot[],
  session: AdminSession | null,
  ctx: RequestContext,
  now: Date,
  batch?: string,
): Promise<Set<string>> {
  if (toStamp.length === 0) return new Set();
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
      details: issuedDetails(s, batch),
      where: whereOf(ctx),
      device: deviceOf(ctx),
    });
  }
  return ids;
}

/** One note: true when this call stamped it, false when it was issued in the meantime. */
async function stampFirstIssue(
  tx: Tx,
  snapshot: InvoiceSnapshot,
  session: AdminSession,
  ctx: RequestContext,
  now: Date,
): Promise<boolean> {
  const ids = await stampFirstIssues(tx, [snapshot], session, ctx, now);
  return ids.has(snapshot.obligationId);
}

/**
 * Common path of every multi-note print (monthly run, taxpayer selection). Same order as the
 * single note: the notes are RENDERED FIRST, from the snapshots as they will read once stamped
 * (issued now, by this user), then the unissued ones are stamped and journaled in one short
 * transaction. A render failure leaves every note unissued. When a concurrent first issue took
 * some of the notes, they are reloaded and re-rendered so the print shows the real first issue.
 */
async function issueRendered(
  db: Db,
  stored: InvoiceSnapshot[],
  session: AdminSession | null,
  ctx: RequestContext,
  now: Date,
  render: (snapshots: InvoiceSnapshot[]) => Promise<Buffer>,
  reload: () => Promise<InvoiceSnapshot[]>,
  batch?: string,
): Promise<IssuedInvoiceBatch> {
  const issuedBy = session?.fullName ?? null;
  const toStamp = stored.filter((s) => !s.issuedAt);
  const prospective = stored.map((s) => (s.issuedAt ? s : withFirstIssue(s, issuedBy, now)));
  const pdf = await render(prospective);
  if (toStamp.length === 0) return { snapshots: prospective, pdf, firstIssues: 0 };
  const stampedIds = await db.transaction((tx) =>
    stampFirstIssues(tx, toStamp, session, ctx, now, batch),
  );
  if (stampedIds.size === toStamp.length) {
    return { snapshots: prospective, pdf, firstIssues: toStamp.length };
  }
  const reloaded = await reload();
  return { snapshots: reloaded, pdf: await render(reloaded), firstIssues: stampedIds.size };
}

/**
 * Issues the note de perception of one obligation for a Mairie user (Finances, Administrateur,
 * Superviseur, Maire) without rendering it: the first call stamps `invoice_issued_at/_by` and
 * writes `invoice.issued` (WHO = the admin, WHERE = IP, DEVICE = user agent); later calls re-print
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
  return db.transaction((tx) => issueInvoiceInTx(tx, session, ref, ctx, now));
}

/**
 * `issueInvoice` inside the caller's transaction: the path an ad-hoc note takes so that it is
 * born issued in the same transaction that creates its obligation (`lib/invoices/create.ts`),
 * with the `obligation.created` and `invoice.issued` rows committing together.
 */
export async function issueInvoiceInTx(
  tx: Tx,
  session: AdminSession,
  ref: InvoiceRef,
  ctx: RequestContext = {},
  now = new Date(),
): Promise<IssuedInvoice> {
  if (!canIssueInvoice(session.role)) throw new AdminError("forbidden");
  const snapshot = await loadInvoiceSnapshot(tx, ref, now);
  if (!snapshot) throw new AdminError("not_found", JSON.stringify(ref));
  if (snapshot.issuedAt) return { snapshot, firstIssue: false };
  if (!isIssuable(snapshot)) throw new AdminError("invalid_state", snapshot.status);
  if (!(await stampFirstIssue(tx, snapshot, session, ctx, now))) {
    const reloaded = await loadInvoiceSnapshot(tx, ref, now);
    return { snapshot: reloaded ?? snapshot, firstIssue: false };
  }
  return { snapshot: withFirstIssue(snapshot, session.fullName, now), firstIssue: true };
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
 * The notes of a chosen set of obligations (the dashboard's « Notes de perception » screen and
 * the « Générer la note de perception » button of a taxpayer page) as ONE PDF, one page per note,
 * in print-run order (taxpayer, period, tax). Every id must exist (`not_found` otherwise, nothing
 * is printed); obligations that are paid, waived or cancelled are left out of the print, and the
 * request is refused with `invalid_state` only when none of the ids is open. Issued exactly like
 * the print run: rendered first, then the unissued notes are stamped in the user's name and one
 * `invoice.issued` row each records WHO, IP and user agent; a later print re-issues nothing.
 */
export async function issueInvoicesPdf(
  db: Db,
  session: AdminSession,
  obligationIds: readonly string[],
  ctx: RequestContext = {},
  now = new Date(),
): Promise<IssuedInvoiceBatch> {
  if (!canIssueInvoice(session.role)) throw new AdminError("forbidden");
  const ids = [...new Set(obligationIds)];
  if (ids.length === 0) throw new AdminError("invalid_input", "obligations");
  const stored = await loadInvoiceSnapshotsForObligations(db, ids, now);
  const found = new Set(stored.map((s) => s.obligationId));
  const unknown = ids.find((id) => !found.has(id));
  if (unknown) throw new AdminError("not_found", unknown);
  // Open notes are issued (or re-printed); a note issued earlier stays printable after payment
  // (the document then carries the « NOTE RÉGLÉE » mark). A settled obligation never issued is
  // skipped: there is nothing to claim.
  const printable = (rows: typeof stored) => rows.filter((s) => s.issuedAt || isIssuable(s));
  const open = printable(stored);
  if (open.length === 0) {
    throw new AdminError("invalid_state", [...new Set(stored.map((s) => s.status))].join(","));
  }
  const label = singleTaxpayerOf(open) ?? t.admin.invoices.selectionLabel;
  const openIds = open.map((s) => s.obligationId);
  return issueRendered(
    db,
    open,
    session,
    ctx,
    now,
    (snapshots) => renderInvoiceBatchPdf(snapshots, label),
    async () => printable(await loadInvoiceSnapshotsForObligations(db, openIds, now)),
  );
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
  return issueRendered(
    db,
    stored,
    session,
    ctx,
    now,
    (snapshots) => renderInvoiceBatchPdf(snapshots, monthLabel),
    () => loadInvoiceSnapshotsForPeriod(db, period, now),
    month,
  );
}
