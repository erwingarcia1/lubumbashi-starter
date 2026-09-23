import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminError } from "@/lib/admin/errors";
import { admins, auditLog, obligations, taxpayers } from "@/lib/db/schema";
import type { AdminSession } from "@/lib/identity/session";
import { issueInvoice } from "@/lib/invoices/issue";
import { NOTE_TEMPLATE_VERSION } from "@/lib/invoices/pdf";
import { loadInvoiceSnapshot } from "@/lib/invoices/snapshot";
import { buildReport } from "@/lib/reports";
import { runSeed } from "@/scripts/seed";

import { appDb } from "./db";

/** Fresh obligations in a random far-future year: the seeded ones may already be issued. */
const YEAR = 2100 + Math.floor(Math.random() * 800);
const created: string[] = [];

let finances: AdminSession;
let administrateur: AdminSession;
let auditeur: AdminSession;
let maire: AdminSession;
let template: typeof obligations.$inferSelect;

const sessionFor = async (email: string, role: AdminSession["role"]): Promise<AdminSession> => {
  const [row] = await appDb().select().from(admins).where(eq(admins.email, email));
  if (!row) throw new Error(`no admin ${email}`);
  return {
    adminId: row.id,
    authUserId: row.authUserId ?? "00000000-0000-0000-0000-000000000000",
    email: row.email,
    fullName: row.fullName,
    role,
  };
};

async function freshObligation(month: number, amountFc = 5000) {
  const mm = String(month).padStart(2, "0");
  const [o] = await appDb()
    .insert(obligations)
    .values({
      entityId: template.entityId,
      taxpayerId: template.taxpayerId,
      taxRuleId: template.taxRuleId,
      taxRuleVersionId: template.taxRuleVersionId,
      periodStart: `${YEAR}-${mm}-01`,
      periodEnd: `${YEAR}-${mm}-28`,
      dueDate: `${YEAR}-${mm}-28`,
      amountFc,
    })
    .returning();
  created.push(o!.id);
  return o!;
}

async function auditRowsFor(invoiceNo: string) {
  return appDb()
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, "invoice.issued"),
        eq(auditLog.objectType, "obligation"),
        eq(auditLog.objectId, invoiceNo),
      ),
    )
    .orderBy(asc(auditLog.id));
}

describe("note de perception: issue, re-print, roles, print run (D35)", () => {
  beforeAll(async () => {
    const db = appDb();
    await runSeed(db);
    finances = await sessionFor("ngoy.k@lubumbashi.cd", "finances");
    administrateur = await sessionFor("admin@lubumbashi.cd", "administrateur");
    auditeur = await sessionFor("auditeur@lubumbashi.cd", "auditeur");
    maire = await sessionFor("maire@lubumbashi.cd", "maire");
    const [tp] = await db
      .select({ id: taxpayers.id })
      .from(taxpayers)
      .where(eq(taxpayers.taxpayerNo, "LUB-KAM-00000125"));
    template = (
      await db.select().from(obligations).where(eq(obligations.taxpayerId, tp!.id)).limit(1)
    )[0]!;
  });

  afterAll(async () => {
    if (created.length) await appDb().delete(obligations).where(inArray(obligations.id, created));
  });

  it("the first issue stamps the obligation and journals WHO/WHERE/DEVICE; a re-print keeps the first date", async () => {
    const db = appDb();
    const o = await freshObligation(4);
    expect(o.invoiceNo).toMatch(/^AV-\d{4}-\d{6}$/);
    const t1 = new Date("2026-09-23T08:15:00+02:00");
    const first = await issueInvoice(
      db,
      finances,
      { invoiceNo: o.invoiceNo! },
      { ip: "41.243.0.10", userAgent: "vitest" },
      t1,
    );
    expect(first.firstIssue).toBe(true);
    expect(first.snapshot.invoiceNo).toBe(o.invoiceNo);
    expect(first.snapshot.issuedAt).toBe(t1.toISOString());
    expect(first.snapshot.issuedBy).toBe(finances.fullName);
    expect(first.snapshot.issuedBySystem).toBe(false);
    expect(first.snapshot.outstandingFc).toBe(5000);
    expect(first.snapshot.verificationUrl).toContain(`/f/${o.invoiceNo}/${o.invoiceToken}`);

    const rows = await auditRowsFor(o.invoiceNo!);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.actorType).toBe("admin");
    expect(row.actorId).toBe(finances.adminId);
    expect(row.actorRole).toBe("finances");
    expect(row.actorLabel).toBe(finances.email);
    expect(row.ip).toBe("41.243.0.10");
    expect(row.userAgent).toBe("vitest");
    expect(row.details).toMatchObject({
      obligationId: o.id,
      taxpayerNo: "LUB-KAM-00000125",
      amountFc: 5000,
      outstandingFc: 5000,
      templateVersion: NOTE_TEMPLATE_VERSION,
    });

    // Second issue, another user, later: nothing changes, nothing is journaled again.
    const t2 = new Date("2026-09-24T09:00:00+02:00");
    const again = await issueInvoice(db, administrateur, { obligationId: o.id }, {}, t2);
    expect(again.firstIssue).toBe(false);
    expect(again.snapshot.issuedAt).toBe(t1.toISOString());
    expect(again.snapshot.issuedBy).toBe(finances.fullName);
    expect(again.snapshot.printedAt).toBe(t2.toISOString());
    expect(await auditRowsFor(o.invoiceNo!)).toHaveLength(1);
    const [stored] = await db.select().from(obligations).where(eq(obligations.id, o.id));
    expect(stored!.invoiceIssuedAt?.toISOString()).toBe(t1.toISOString());
    expect(stored!.invoiceIssuedByAdminId).toBe(finances.adminId);
  });

  it("Maire and Auditeur are refused before anything is stamped; unknown and closed notes are refused", async () => {
    const db = appDb();
    const o = await freshObligation(5);
    for (const session of [auditeur, maire]) {
      await expect(issueInvoice(db, session, { invoiceNo: o.invoiceNo! })).rejects.toMatchObject({
        code: "forbidden",
      });
    }
    const [stored] = await db.select().from(obligations).where(eq(obligations.id, o.id));
    expect(stored!.invoiceIssuedAt).toBeNull();
    expect(await auditRowsFor(o.invoiceNo!)).toHaveLength(0);

    await expect(issueInvoice(db, finances, { invoiceNo: "AV-9999-999999" })).rejects.toThrow(
      AdminError,
    );
    await expect(issueInvoice(db, finances, { invoiceNo: "AV-9999-999999" })).rejects.toMatchObject(
      { code: "not_found" },
    );
    await db
      .update(obligations)
      .set({ status: "cancelled", cancelledReason: "test" })
      .where(eq(obligations.id, o.id));
    await expect(issueInvoice(db, finances, { obligationId: o.id })).rejects.toMatchObject({
      code: "invalid_state",
    });
    // Superviseur may issue too (ROLES placeholder for D35).
    const superviseur = await sessionFor("ilunga.m@lubumbashi.cd", "superviseur");
    const other = await freshObligation(6);
    expect((await issueInvoice(db, superviseur, { obligationId: other.id })).firstIssue).toBe(true);
  });

  it("the print run of 2026-09 renders every open note of the month and stamps the unissued ones as the system", async () => {
    const db = appDb();
    const now = new Date("2026-09-23T12:00:00+02:00");
    const [tp] = await db
      .select({ id: taxpayers.id })
      .from(taxpayers)
      .where(eq(taxpayers.taxpayerNo, "LUB-KAM-00000125"));
    const [sept] = await db
      .select()
      .from(obligations)
      .where(and(eq(obligations.taxpayerId, tp!.id), eq(obligations.periodStart, "2026-09-01")));
    expect(sept?.status).toBe("due");
    // Earlier runs (tests, demos) may have stamped it: start from an unissued note.
    await db
      .update(obligations)
      .set({ invoiceIssuedAt: null, invoiceIssuedByAdminId: null })
      .where(eq(obligations.id, sept!.id));

    const file = await buildReport(db, "invoices", { format: "pdf", month: "2026-09" }, now);
    expect(file.filename).toBe("notes-perception-2026-09.pdf");
    expect(file.contentType).toBe("application/pdf");
    expect(file.rows).toBeGreaterThan(0);
    expect(file.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(file.body.toString("latin1").match(/\/Type \/Page\b(?!s)/g)).toHaveLength(file.rows);

    const snapshot = await loadInvoiceSnapshot(db, { obligationId: sept!.id }, now);
    expect(snapshot?.issuedAt).toBe(now.toISOString());
    expect(snapshot?.issuedBySystem).toBe(true);
    expect(snapshot?.issuedBy).toBeNull();
    const rows = await auditRowsFor(sept!.invoiceNo!);
    const batchRow = rows.at(-1)!;
    expect(batchRow.actorType).toBe("system");
    expect(batchRow.details).toMatchObject({ batch: "2026-09", obligationId: sept!.id });

    // A second run re-prints without a new stamp or journal row.
    const before = rows.length;
    const again = await buildReport(
      db,
      "invoices",
      { format: "pdf", month: "2026-09" },
      new Date("2026-09-24T12:00:00+02:00"),
    );
    expect(again.rows).toBe(file.rows);
    expect(await auditRowsFor(sept!.invoiceNo!)).toHaveLength(before);
    expect((await loadInvoiceSnapshot(db, { obligationId: sept!.id }))?.issuedAt).toBe(
      now.toISOString(),
    );
  });
});
