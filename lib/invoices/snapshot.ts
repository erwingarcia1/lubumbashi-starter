import { and, asc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Db, Tx } from "@/lib/db/client";
import {
  admins,
  categories,
  entities,
  obligations,
  taxRules,
  taxRuleVersions,
  taxpayers,
  zones,
} from "@/lib/db/schema";
import { invoiceUrlFor } from "@/lib/portal/invoice";
import { computePenalty } from "@/lib/tax-engine";
import { businessDate, type Period } from "@/lib/time";

export type InvoiceObligationStatus = "due" | "partially_paid" | "paid" | "waived" | "cancelled";

/** Statuses a note de perception can be issued for; anything else is only re-printable. */
export const ISSUABLE_STATUSES = ["due", "partially_paid"] as const;

/** Everything printed on a note de perception, computed from the database at print time. */
export interface InvoiceSnapshot {
  /** The avis number `AV-YYMM-NNNNNN` doubles as the note number (D35 placeholder). */
  invoiceNo: string;
  obligationId: string;
  status: InvoiceObligationStatus;
  taxpayer: { taxpayerNo: string; fullName: string; phone: string; address: string };
  entity: { name: string; address: string; categoryLabel: string };
  commune: string;
  quartier: string | null;
  tax: { code: string; label: string };
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  amountFc: number;
  penaltyFc: number;
  paidFc: number;
  outstandingFc: number;
  /** First issue from the back office (ISO instant); null until the note has been issued. */
  issuedAt: string | null;
  /** Full name of the issuing admin; null when not issued yet or issued by a print run. */
  issuedBy: string | null;
  issuedBySystem: boolean;
  /** When the amounts were computed (ISO instant). */
  printedAt: string;
  verificationUrl: string;
}

export type InvoiceRef = { obligationId: string } | { invoiceNo: string };

/** One joined row of the note query; `toInvoiceSnapshot` turns it into the printable snapshot. */
export interface InvoiceRow {
  obligation: {
    id: string;
    invoiceNo: string | null;
    invoiceToken: string | null;
    status: InvoiceObligationStatus;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    amountFc: number;
    penaltyFc: number;
    paidFc: number;
    invoiceIssuedAt: Date | null;
    invoiceIssuedByAdminId: string | null;
  };
  taxpayer: { taxpayerNo: string; fullName: string; phone: string; address: string };
  entity: { name: string; address: string };
  categoryLabel: string;
  rule: { code: string; labelFr: string };
  version: {
    penaltyKind: "none" | "once_percent" | "once_fixed" | "monthly_percent";
    penaltyRateBp: number | null;
    penaltyAmountFc: number | null;
    graceDays: number;
    penaltyCapBp: number | null;
  };
  commune: string;
  quartier: string | null;
  issuerName: string | null;
}

function assertFc(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer of FC, got ${value}`);
  }
}

/** Principal + penalty − paid, never negative (an over-allocation prints as 0), integers only. */
export function outstandingOf(o: { amountFc: number; penaltyFc: number; paidFc: number }): number {
  assertFc(o.amountFc, "amountFc");
  assertFc(o.penaltyFc, "penaltyFc");
  assertFc(o.paidFc, "paidFc");
  return Math.max(0, o.amountFc + o.penaltyFc - o.paidFc);
}

/**
 * Penalty printed on the note: the stored (billed) penalty, or the amount accrued as of the
 * print date when that is higher, for obligations still open. Closed obligations keep what
 * was stored.
 */
// DECISION-PENDING: D35 — whether penalties accrued since the first issue appear on a re-print.
export function penaltyAsOf(
  version: InvoiceRow["version"],
  obligation: Pick<InvoiceRow["obligation"], "status" | "dueDate" | "amountFc" | "penaltyFc">,
  asOf: string,
): number {
  const open = (ISSUABLE_STATUSES as readonly string[]).includes(obligation.status);
  if (!open) return obligation.penaltyFc;
  return Math.max(obligation.penaltyFc, computePenalty(version, obligation, asOf));
}

/** Pure: a printable snapshot from a joined row, amounts as of `now` (business date). */
export function toInvoiceSnapshot(
  row: InvoiceRow,
  now: Date,
  appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "",
): InvoiceSnapshot {
  const o = row.obligation;
  if (!o.invoiceNo || !o.invoiceToken) {
    throw new Error(`obligation ${o.id} has no avis number; the database trigger assigns one`);
  }
  const penaltyFc = penaltyAsOf(row.version, o, businessDate(now));
  const amounts = { amountFc: o.amountFc, penaltyFc, paidFc: o.paidFc };
  return {
    invoiceNo: o.invoiceNo,
    obligationId: o.id,
    status: o.status,
    taxpayer: { ...row.taxpayer },
    entity: {
      name: row.entity.name,
      address: row.entity.address,
      categoryLabel: row.categoryLabel,
    },
    commune: row.commune,
    quartier: row.quartier,
    tax: { code: row.rule.code, label: row.rule.labelFr },
    periodStart: o.periodStart,
    periodEnd: o.periodEnd,
    dueDate: o.dueDate,
    ...amounts,
    outstandingFc: outstandingOf(amounts),
    issuedAt: o.invoiceIssuedAt ? o.invoiceIssuedAt.toISOString() : null,
    issuedBy: o.invoiceIssuedAt ? row.issuerName : null,
    issuedBySystem: o.invoiceIssuedAt !== null && o.invoiceIssuedByAdminId === null,
    printedAt: now.toISOString(),
    verificationUrl: invoiceUrlFor(o.invoiceNo, o.invoiceToken, appUrl),
  };
}

const commune = alias(zones, "invoice_commune");
const quartier = alias(zones, "invoice_quartier");

/** The joined rows behind the notes, ordered for a print run (taxpayer, period, tax). */
export async function loadInvoiceRows(db: Db | Tx, where: SQL): Promise<InvoiceRow[]> {
  return db
    .select({
      obligation: {
        id: obligations.id,
        invoiceNo: obligations.invoiceNo,
        invoiceToken: obligations.invoiceToken,
        status: obligations.status,
        periodStart: obligations.periodStart,
        periodEnd: obligations.periodEnd,
        dueDate: obligations.dueDate,
        amountFc: obligations.amountFc,
        penaltyFc: obligations.penaltyFc,
        paidFc: obligations.paidFc,
        invoiceIssuedAt: obligations.invoiceIssuedAt,
        invoiceIssuedByAdminId: obligations.invoiceIssuedByAdminId,
      },
      taxpayer: {
        taxpayerNo: taxpayers.taxpayerNo,
        fullName: taxpayers.fullName,
        phone: taxpayers.phone,
        address: taxpayers.address,
      },
      entity: { name: entities.name, address: entities.address },
      categoryLabel: categories.labelFr,
      rule: { code: taxRules.code, labelFr: taxRules.labelFr },
      version: {
        penaltyKind: taxRuleVersions.penaltyKind,
        penaltyRateBp: taxRuleVersions.penaltyRateBp,
        penaltyAmountFc: taxRuleVersions.penaltyAmountFc,
        graceDays: taxRuleVersions.graceDays,
        penaltyCapBp: taxRuleVersions.penaltyCapBp,
      },
      commune: commune.name,
      quartier: quartier.name,
      issuerName: admins.fullName,
    })
    .from(obligations)
    .innerJoin(taxpayers, eq(taxpayers.id, obligations.taxpayerId))
    .innerJoin(entities, eq(entities.id, obligations.entityId))
    .innerJoin(categories, eq(categories.id, entities.categoryId))
    .innerJoin(taxRules, eq(taxRules.id, obligations.taxRuleId))
    .innerJoin(taxRuleVersions, eq(taxRuleVersions.id, obligations.taxRuleVersionId))
    .innerJoin(commune, eq(commune.id, entities.communeId))
    .leftJoin(quartier, eq(quartier.id, entities.quartierId))
    .leftJoin(admins, eq(admins.id, obligations.invoiceIssuedByAdminId))
    .where(where)
    .orderBy(asc(taxpayers.taxpayerNo), asc(obligations.periodStart), asc(taxRules.code));
}

export function invoiceRefWhere(ref: InvoiceRef): SQL {
  return "obligationId" in ref
    ? eq(obligations.id, ref.obligationId)
    : eq(obligations.invoiceNo, ref.invoiceNo);
}

/** Obligations of a print run: open (due or partially paid) with a period starting in `period`. */
export function printRunWhere(period: Period): SQL {
  return and(
    inArray(obligations.status, [...ISSUABLE_STATUSES]),
    gte(obligations.periodStart, period.start),
    lte(obligations.periodStart, period.end),
  )!;
}

export async function loadInvoiceSnapshot(
  db: Db | Tx,
  ref: InvoiceRef,
  now = new Date(),
): Promise<InvoiceSnapshot | null> {
  const [row] = await loadInvoiceRows(db, invoiceRefWhere(ref));
  return row ? toInvoiceSnapshot(row, now) : null;
}

export async function loadInvoiceSnapshotsForPeriod(
  db: Db | Tx,
  period: Period,
  now = new Date(),
): Promise<InvoiceSnapshot[]> {
  const rows = await loadInvoiceRows(db, printRunWhere(period));
  return rows.map((r) => toInvoiceSnapshot(r, now));
}
