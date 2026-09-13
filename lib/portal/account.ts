import { and, desc, eq, inArray } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import {
  complaintCategories,
  complaints,
  entities,
  obligations,
  payments,
  receipts,
  taxRules,
  taxpayers,
} from "@/lib/db/schema";
import { summarizeBalance, type Balance } from "@/lib/registry/balance";
import { businessDate } from "@/lib/time";

export interface PortalObligation {
  id: string;
  ruleLabelFr: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  amountFc: number;
  penaltyFc: number;
  paidFc: number;
  outstandingFc: number;
  status: (typeof obligations.$inferSelect)["status"];
  late: boolean;
  invoiceNo: string | null;
  invoiceToken: string | null;
}

export interface PortalReceipt {
  receiptNo: string;
  amountFc: number;
  issuedAt: Date;
  channel: string;
  verifyToken: string;
  status: "issued" | "cancelled";
}

export interface PortalComplaint {
  id: string;
  createdAt: Date;
  categoryLabelFr: string;
  status: (typeof complaints.$inferSelect)["status"];
}

export interface PortalAccount {
  taxpayer: { id: string; taxpayerNo: string; fullName: string; phone: string; address: string };
  balance: Balance;
  /** Open obligations (due or partially paid), oldest first. */
  open: PortalObligation[];
  receipts: PortalReceipt[];
  complaints: PortalComplaint[];
}

/** Everything the portal home shows for one taxpayer (screen p-home). */
export async function getPortalAccount(
  db: Db,
  taxpayerId: string,
  now = new Date(),
): Promise<PortalAccount> {
  const asOf = businessDate(now);
  const [tp] = await db.select().from(taxpayers).where(eq(taxpayers.id, taxpayerId));
  if (!tp) throw new Error("taxpayer not found");
  const [entity] = await db
    .select({ address: entities.address })
    .from(entities)
    .where(eq(entities.taxpayerId, taxpayerId))
    .limit(1);

  const rows = await db
    .select({ o: obligations, ruleLabelFr: taxRules.labelFr })
    .from(obligations)
    .innerJoin(taxRules, eq(taxRules.id, obligations.taxRuleId))
    .where(eq(obligations.taxpayerId, taxpayerId))
    .orderBy(obligations.dueDate);
  const balance = summarizeBalance(
    rows.map((r) => r.o),
    asOf,
  );
  const open = rows
    .filter((r) => r.o.status === "due" || r.o.status === "partially_paid")
    .map(({ o, ruleLabelFr }) => ({
      id: o.id,
      ruleLabelFr,
      periodStart: o.periodStart,
      periodEnd: o.periodEnd,
      dueDate: o.dueDate,
      amountFc: o.amountFc,
      penaltyFc: o.penaltyFc,
      paidFc: o.paidFc,
      outstandingFc: Math.max(0, o.amountFc + o.penaltyFc - o.paidFc),
      status: o.status,
      late: o.dueDate < asOf,
      invoiceNo: o.invoiceNo,
      invoiceToken: o.invoiceToken,
    }));

  const receiptRows = await db
    .select({ r: receipts, channel: payments.channel })
    .from(receipts)
    .innerJoin(payments, eq(payments.id, receipts.paymentId))
    .where(eq(receipts.taxpayerId, taxpayerId))
    .orderBy(desc(receipts.issuedAt))
    .limit(12);

  const complaintRows = await db
    .select({ c: complaints, categoryLabelFr: complaintCategories.labelFr })
    .from(complaints)
    .innerJoin(complaintCategories, eq(complaintCategories.id, complaints.categoryId))
    .where(eq(complaints.taxpayerId, taxpayerId))
    .orderBy(desc(complaints.createdAt))
    .limit(10);

  return {
    taxpayer: {
      id: tp.id,
      taxpayerNo: tp.taxpayerNo,
      fullName: tp.fullName,
      phone: tp.phone,
      address: entity?.address ?? tp.address,
    },
    balance,
    open,
    receipts: receiptRows.map(({ r, channel }) => ({
      receiptNo: r.receiptNo,
      amountFc: r.amountFc,
      issuedAt: r.issuedAt,
      channel,
      verifyToken: r.verifyToken,
      status: r.status,
    })),
    complaints: complaintRows.map(({ c, categoryLabelFr }) => ({
      id: c.id,
      createdAt: c.createdAt,
      categoryLabelFr,
      status: c.status,
    })),
  };
}

/** Open obligations by id for one taxpayer (used to validate a portal payment's selection). */
export async function openObligationsById(db: Db, taxpayerId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select({ id: obligations.id })
    .from(obligations)
    .where(
      and(
        eq(obligations.taxpayerId, taxpayerId),
        inArray(obligations.id, ids),
        inArray(obligations.status, ["due", "partially_paid"]),
      ),
    );
}
