import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { GET as reportsGet } from "@/app/api/v1/admin/reports/[code]/route";
import { AdminError } from "@/lib/admin/errors";
import { admins, auditLog, obligations, taxpayers } from "@/lib/db/schema";
import { getAdminSession, type AdminSession } from "@/lib/identity/session";
import { issueInvoice, issueInvoiceBatch, issueInvoicePdf } from "@/lib/invoices/issue";
import { NOTE_TEMPLATE_VERSION, renderInvoiceBatchPdf, renderInvoicePdf } from "@/lib/invoices/pdf";
import { loadInvoiceSnapshot } from "@/lib/invoices/snapshot";
import { buildReport } from "@/lib/reports";
import { monthPeriodOf } from "@/lib/time";
import { runSeed } from "@/scripts/seed";

import { appDb } from "./db";

// The reports route reads the Mairie session from the Supabase cookies: stubbed so the route
// can be called as a function with the role under test.
vi.mock("@/lib/identity/session", () => ({ getAdminSession: vi.fn(), requireAdmin: vi.fn() }));
// The renderers are the real ones, wrapped so a test can make one fail or read what it rendered.
vi.mock("@/lib/invoices/pdf", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/invoices/pdf")>();
  return {
    ...original,
    renderInvoicePdf: vi.fn(original.renderInvoicePdf),
    renderInvoiceBatchPdf: vi.fn(original.renderInvoiceBatchPdf),
  };
});

/** Fresh obligations in a random far-future year: the seeded ones may already be issued. */
const YEAR = 2100 + Math.floor(Math.random() * 800);
const created: string[] = [];
const CTX = { ip: "41.243.0.10", userAgent: "vitest" };

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

async function stored(id: string) {
  const [row] = await appDb().select().from(obligations).where(eq(obligations.id, id));
  return row!;
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

async function exportsOfInvoices() {
  const rows = await appDb()
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.action, "report.exported"), eq(auditLog.objectId, "invoices/pdf")));
  return rows.length;
}

/** The seeded September 2026 obligation of LUB-KAM-00000125, reset to "not issued yet". */
async function unissuedSeptemberNote() {
  const db = appDb();
  const [tp] = await db
    .select({ id: taxpayers.id })
    .from(taxpayers)
    .where(eq(taxpayers.taxpayerNo, "LUB-KAM-00000125"));
  const [sept] = await db
    .select()
    .from(obligations)
    .where(and(eq(obligations.taxpayerId, tp!.id), eq(obligations.periodStart, "2026-09-01")));
  if (!sept) throw new Error("seed: LUB-KAM-00000125 has no September 2026 obligation");
  expect(sept.status).toBe("due");
  // Earlier runs (tests, demos) may have stamped it: start from an unissued note.
  await db
    .update(obligations)
    .set({ invoiceIssuedAt: null, invoiceIssuedByAdminId: null })
    .where(eq(obligations.id, sept.id));
  return sept;
}

const SEPT = { format: "pdf" as const, month: "2026-09" };

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
    const first = await issueInvoice(db, finances, { invoiceNo: o.invoiceNo! }, CTX, t1);
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
    const s = await stored(o.id);
    expect(s.invoiceIssuedAt?.toISOString()).toBe(t1.toISOString());
    expect(s.invoiceIssuedByAdminId).toBe(finances.adminId);
  });

  it("Maire and Auditeur are refused before anything is stamped; unknown and closed notes are refused", async () => {
    const db = appDb();
    const o = await freshObligation(5);
    for (const session of [auditeur, maire]) {
      await expect(issueInvoice(db, session, { invoiceNo: o.invoiceNo! })).rejects.toMatchObject({
        code: "forbidden",
      });
      await expect(issueInvoicePdf(db, session, { invoiceNo: o.invoiceNo! })).rejects.toMatchObject(
        { code: "forbidden" },
      );
    }
    expect((await stored(o.id)).invoiceIssuedAt).toBeNull();
    expect(await auditRowsFor(o.invoiceNo!)).toHaveLength(0);

    await expect(issueInvoice(db, finances, { invoiceNo: "AV-9999-999999" })).rejects.toThrow(
      AdminError,
    );
    await expect(issueInvoice(db, finances, { invoiceNo: "AV-9999-999999" })).rejects.toMatchObject(
      { code: "not_found" },
    );
    await expect(
      issueInvoicePdf(db, finances, { invoiceNo: "AV-9999-999999" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await db
      .update(obligations)
      .set({ status: "cancelled", cancelledReason: "test" })
      .where(eq(obligations.id, o.id));
    await expect(issueInvoice(db, finances, { obligationId: o.id })).rejects.toMatchObject({
      code: "invalid_state",
    });
    await expect(issueInvoicePdf(db, finances, { obligationId: o.id })).rejects.toMatchObject({
      code: "invalid_state",
    });
    // Superviseur may issue too (ROLES placeholder for D35).
    const superviseur = await sessionFor("ilunga.m@lubumbashi.cd", "superviseur");
    const other = await freshObligation(6);
    expect((await issueInvoice(db, superviseur, { obligationId: other.id })).firstIssue).toBe(true);
  });

  it("issueInvoicePdf renders before stamping: a failed render leaves the note unissued and unjournaled", async () => {
    const db = appDb();
    const o = await freshObligation(7);
    vi.mocked(renderInvoicePdf).mockRejectedValueOnce(new Error("render failed"));
    await expect(issueInvoicePdf(db, finances, { invoiceNo: o.invoiceNo! }, CTX)).rejects.toThrow(
      "render failed",
    );
    const untouched = await stored(o.id);
    expect(untouched.invoiceIssuedAt).toBeNull();
    expect(untouched.invoiceIssuedByAdminId).toBeNull();
    expect(await auditRowsFor(o.invoiceNo!)).toHaveLength(0);

    // The next print issues the note: the buffer served is the one rendered from the snapshot
    // as stamped (issued now, by her), and the stamp + journal row follow.
    const t1 = new Date("2026-09-23T08:15:00+02:00");
    vi.mocked(renderInvoicePdf).mockClear();
    const first = await issueInvoicePdf(db, finances, { invoiceNo: o.invoiceNo! }, CTX, t1);
    expect(first.firstIssue).toBe(true);
    expect(first.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(first.snapshot).toMatchObject({
      issuedAt: t1.toISOString(),
      issuedBy: finances.fullName,
      issuedBySystem: false,
    });
    expect(vi.mocked(renderInvoicePdf)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(renderInvoicePdf).mock.calls[0]![0]).toMatchObject({
      invoiceNo: o.invoiceNo,
      issuedAt: t1.toISOString(),
      issuedBy: finances.fullName,
    });
    const s = await stored(o.id);
    expect(s.invoiceIssuedAt?.toISOString()).toBe(t1.toISOString());
    expect(s.invoiceIssuedByAdminId).toBe(finances.adminId);
    const rows = await auditRowsFor(o.invoiceNo!);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorType: "admin",
      actorId: finances.adminId,
      actorLabel: finances.email,
      ip: "41.243.0.10",
      userAgent: "vitest",
    });

    // A re-print renders the stored snapshot: first date kept, nothing stamped or journaled again.
    vi.mocked(renderInvoicePdf).mockClear();
    const again = await issueInvoicePdf(
      db,
      administrateur,
      { obligationId: o.id },
      {},
      new Date("2026-09-24T09:00:00+02:00"),
    );
    expect(again.firstIssue).toBe(false);
    expect(again.snapshot.issuedAt).toBe(t1.toISOString());
    expect(again.snapshot.issuedBy).toBe(finances.fullName);
    expect(again.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(vi.mocked(renderInvoicePdf).mock.calls[0]![0]).toMatchObject({
      issuedAt: t1.toISOString(),
      issuedBy: finances.fullName,
    });
    expect(await auditRowsFor(o.invoiceNo!)).toHaveLength(1);
  });

  it("the print run of 2026-09 renders every open note of the month and issues the unissued ones in the caller's name", async () => {
    const db = appDb();
    const now = new Date("2026-09-23T12:00:00+02:00");
    const sept = await unissuedSeptemberNote();

    const file = await buildReport(db, "invoices", SEPT, now, { session: finances, ctx: CTX });
    expect(file.filename).toBe("notes-perception-2026-09.pdf");
    expect(file.contentType).toBe("application/pdf");
    expect(file.rows).toBeGreaterThan(0);
    expect(file.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(file.body.toString("latin1").match(/\/Type \/Page\b(?!s)/g)).toHaveLength(file.rows);

    const snapshot = await loadInvoiceSnapshot(db, { obligationId: sept.id }, now);
    expect(snapshot?.issuedAt).toBe(now.toISOString());
    expect(snapshot?.issuedBySystem).toBe(false);
    expect(snapshot?.issuedBy).toBe(finances.fullName);
    expect((await stored(sept.id)).invoiceIssuedByAdminId).toBe(finances.adminId);
    const rows = await auditRowsFor(sept.invoiceNo!);
    const batchRow = rows.at(-1)!;
    expect(batchRow).toMatchObject({
      actorType: "admin",
      actorId: finances.adminId,
      actorRole: "finances",
      actorLabel: finances.email,
      ip: "41.243.0.10",
      userAgent: "vitest",
    });
    expect(batchRow.details).toMatchObject({
      batch: "2026-09",
      obligationId: sept.id,
      taxpayerNo: "LUB-KAM-00000125",
      amountFc: sept.amountFc,
      templateVersion: NOTE_TEMPLATE_VERSION,
    });

    // A second run, by someone else, re-prints without a new stamp or journal row.
    const before = rows.length;
    const again = await buildReport(db, "invoices", SEPT, new Date("2026-09-24T12:00:00+02:00"), {
      session: administrateur,
      ctx: CTX,
    });
    expect(again.rows).toBe(file.rows);
    expect(await auditRowsFor(sept.invoiceNo!)).toHaveLength(before);
    expect((await loadInvoiceSnapshot(db, { obligationId: sept.id }))?.issuedAt).toBe(
      now.toISOString(),
    );
  });

  it("the print run refuses Maire and Auditeur, refuses to run without a session, and stamps nothing when the render fails", async () => {
    const db = appDb();
    const sept = await unissuedSeptemberNote();
    const before = (await auditRowsFor(sept.invoiceNo!)).length;

    await expect(buildReport(db, "invoices", SEPT)).rejects.toThrow(/session/);
    for (const session of [maire, auditeur]) {
      await expect(
        buildReport(db, "invoices", SEPT, new Date(), { session, ctx: CTX }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    // Render first, stamp after: nothing is recorded when the PDF cannot be produced.
    vi.mocked(renderInvoiceBatchPdf).mockRejectedValueOnce(new Error("render failed"));
    await expect(
      buildReport(db, "invoices", SEPT, new Date(), { session: finances, ctx: CTX }),
    ).rejects.toThrow("render failed");

    expect((await stored(sept.id)).invoiceIssuedAt).toBeNull();
    expect(await auditRowsFor(sept.invoiceNo!)).toHaveLength(before);
  });

  it("a job (no session) issues the batch as the system actor", async () => {
    const db = appDb();
    const now = new Date("2026-09-23T12:00:00+02:00");
    const sept = await unissuedSeptemberNote();
    const run = await issueInvoiceBatch(db, monthPeriodOf(2026, 9), "2026-09", null, {}, now);
    expect(run.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(run.firstIssues).toBeGreaterThan(0);
    const mine = run.snapshots.find((s) => s.obligationId === sept.id)!;
    expect(mine).toMatchObject({
      issuedAt: now.toISOString(),
      issuedBy: null,
      issuedBySystem: true,
    });
    expect((await stored(sept.id)).invoiceIssuedByAdminId).toBeNull();
    const row = (await auditRowsFor(sept.invoiceNo!)).at(-1)!;
    expect(row.actorType).toBe("system");
    expect(row.details).toMatchObject({ batch: "2026-09", obligationId: sept.id });
  });

  it("GET /api/v1/admin/reports/invoices: Maire and Auditeur get 403 and stamp nothing; Finances' run is hers", async () => {
    const sept = await unissuedSeptemberNote();
    const before = (await auditRowsFor(sept.invoiceNo!)).length;
    const exportsBefore = await exportsOfInvoices();
    const call = () =>
      reportsGet(
        new Request(
          "http://localhost:3000/api/v1/admin/reports/invoices?format=pdf&month=2026-09",
          {
            headers: { "x-forwarded-for": "41.243.0.10, 10.0.0.1", "user-agent": "vitest" },
          },
        ),
        { params: Promise.resolve({ code: "invoices" }) },
      );

    for (const session of [maire, auditeur]) {
      vi.mocked(getAdminSession).mockResolvedValue(session);
      const res = await call();
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ ok: false, error: { code: "forbidden" } });
    }
    expect((await stored(sept.id)).invoiceIssuedAt).toBeNull();
    expect(await auditRowsFor(sept.invoiceNo!)).toHaveLength(before);
    expect(await exportsOfInvoices()).toBe(exportsBefore);

    vi.mocked(getAdminSession).mockResolvedValue(finances);
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain(
      'filename="notes-perception-2026-09.pdf"',
    );
    expect(
      Buffer.from(await res.arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");
    expect((await stored(sept.id)).invoiceIssuedByAdminId).toBe(finances.adminId);
    const row = (await auditRowsFor(sept.invoiceNo!)).at(-1)!;
    expect(row).toMatchObject({
      actorType: "admin",
      actorId: finances.adminId,
      actorLabel: finances.email,
      ip: "41.243.0.10",
      userAgent: "vitest",
    });
    expect(row.details).toMatchObject({ batch: "2026-09" });
    expect(await exportsOfInvoices()).toBe(exportsBefore + 1);

    vi.mocked(getAdminSession).mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
});
