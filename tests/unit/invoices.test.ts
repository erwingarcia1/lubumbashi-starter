import { describe, expect, it } from "vitest";

import { NOTE_TEMPLATE_VERSION, renderInvoiceBatchPdf, renderInvoicePdf } from "@/lib/invoices/pdf";
import {
  outstandingOf,
  penaltyAsOf,
  toInvoiceSnapshot,
  type InvoiceRow,
  type InvoiceSnapshot,
} from "@/lib/invoices/snapshot";

const NOW = new Date("2026-09-23T10:00:00+02:00");

function row(over: Partial<InvoiceRow["obligation"]> = {}, issuerName: string | null = null) {
  const r: InvoiceRow = {
    obligation: {
      id: "0f2b7a1c-9d0e-4c5a-8b6d-1e2f3a4b5c6d",
      invoiceNo: "AV-2609-000001",
      invoiceToken: "0123456789abcdef0123456789abcdef",
      status: "due",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      dueDate: "2026-09-30",
      amountFc: 5000,
      penaltyFc: 0,
      paidFc: 0,
      invoiceIssuedAt: null,
      invoiceIssuedByAdminId: null,
      ...over,
    },
    taxpayer: {
      taxpayerNo: "LUB-KAM-00000125",
      fullName: "Mwamba Kasongo Jean",
      phone: "+243994128830",
      address: "Av. Kasaï 214",
    },
    entity: { name: "Résidence Av. Kasaï 214", address: "Av. Kasaï 214" },
    categoryLabel: "Ménage",
    rule: { code: "assainissement_menage", labelFr: "Taxe d’assainissement" },
    version: {
      penaltyKind: "once_percent",
      penaltyRateBp: 1000,
      penaltyAmountFc: null,
      graceDays: 30,
      penaltyCapBp: 10_000,
    },
    commune: "Kampemba",
    quartier: "Bel-Air",
    issuerName,
  };
  return r;
}

describe("note de perception: snapshot maths (D35)", () => {
  it("outstanding = principal + penalty − paid, floored at zero, integers only", () => {
    expect(outstandingOf({ amountFc: 5000, penaltyFc: 500, paidFc: 2000 })).toBe(3500);
    expect(outstandingOf({ amountFc: 5000, penaltyFc: 0, paidFc: 5000 })).toBe(0);
    expect(outstandingOf({ amountFc: 5000, penaltyFc: 0, paidFc: 9000 })).toBe(0);
    expect(() => outstandingOf({ amountFc: 5000.5, penaltyFc: 0, paidFc: 0 })).toThrow(TypeError);
    expect(() => outstandingOf({ amountFc: 5000, penaltyFc: -1, paidFc: 0 })).toThrow(TypeError);
    expect(() => outstandingOf({ amountFc: 5000, penaltyFc: 0, paidFc: 0.1 })).toThrow(TypeError);
  });

  it("prints the penalty accrued as of the print date when it exceeds the stored one", () => {
    const v = row().version;
    const o = { status: "due" as const, dueDate: "2026-07-31", amountFc: 5000, penaltyFc: 0 };
    // 30 grace days → nothing on 30/08, 10 % on 31/08.
    expect(penaltyAsOf(v, o, "2026-08-30")).toBe(0);
    expect(penaltyAsOf(v, o, "2026-08-31")).toBe(500);
    // A billed penalty higher than the accrual is kept.
    expect(penaltyAsOf(v, { ...o, penaltyFc: 700 }, "2026-08-31")).toBe(700);
    // Closed obligations keep the stored penalty whatever the date.
    expect(penaltyAsOf(v, { ...o, status: "paid" }, "2027-01-01")).toBe(0);
    expect(penaltyAsOf(v, { ...o, status: "waived", penaltyFc: 300 }, "2027-01-01")).toBe(300);
  });

  it("builds the snapshot from a joined row: identity, amounts, verification URL, issue stamp", () => {
    const s = toInvoiceSnapshot(row({ paidFc: 2000 }), NOW, "https://demo.example/");
    expect(s.invoiceNo).toBe("AV-2609-000001");
    expect(s.taxpayer.taxpayerNo).toBe("LUB-KAM-00000125");
    expect(s.entity.categoryLabel).toBe("Ménage");
    expect(s.commune).toBe("Kampemba");
    expect(s.quartier).toBe("Bel-Air");
    expect(s.tax.label).toBe("Taxe d’assainissement");
    expect(s.amountFc).toBe(5000);
    expect(s.penaltyFc).toBe(0);
    expect(s.paidFc).toBe(2000);
    expect(s.outstandingFc).toBe(3000);
    expect(s.verificationUrl).toBe(
      "https://demo.example/f/AV-2609-000001/0123456789abcdef0123456789abcdef",
    );
    expect(s.issuedAt).toBeNull();
    expect(s.issuedBy).toBeNull();
    expect(s.issuedBySystem).toBe(false);
    expect(s.printedAt).toBe(NOW.toISOString());

    const at = new Date("2026-09-20T08:00:00Z");
    const byAdmin = toInvoiceSnapshot(
      row({ invoiceIssuedAt: at, invoiceIssuedByAdminId: "a1" }, "Ngoy K."),
      NOW,
    );
    expect(byAdmin.issuedAt).toBe(at.toISOString());
    expect(byAdmin.issuedBy).toBe("Ngoy K.");
    expect(byAdmin.issuedBySystem).toBe(false);
    const bySystem = toInvoiceSnapshot(row({ invoiceIssuedAt: at }), NOW);
    expect(bySystem.issuedBySystem).toBe(true);
    expect(bySystem.issuedBy).toBeNull();
    // A late obligation printed after the grace period carries the accrued penalty.
    const late = toInvoiceSnapshot(row({ dueDate: "2026-07-31" }), NOW);
    expect(late.penaltyFc).toBe(500);
    expect(late.outstandingFc).toBe(5500);
    expect(() => toInvoiceSnapshot(row({ invoiceNo: null }), NOW)).toThrow(/avis number/);
  });
});

describe("note de perception: PDF", () => {
  const snapshot = (): InvoiceSnapshot => toInvoiceSnapshot(row(), NOW, "http://localhost:3000");

  it("renders one A4 note with the number in it and the placeholder template version", async () => {
    expect(NOTE_TEMPLATE_VERSION).toBe("placeholder-1");
    const buf = await renderInvoicePdf(snapshot());
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(2000);
    const raw = buf.toString("latin1");
    expect(raw).toContain("AV-2609-000001");
    // A4 portrait: 595 × 842 pt.
    expect(raw).toMatch(/MediaBox \[0 0 595(\.\d+)? 84[12](\.\d+)?\]/);
    expect(raw.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(1);
  });

  it("renders a settled note and a batch of one page per note (empty batch = one notice page)", async () => {
    const paid = toInvoiceSnapshot(row({ status: "paid", paidFc: 5000 }), NOW);
    expect(paid.outstandingFc).toBe(0);
    expect((await renderInvoicePdf(paid)).subarray(0, 5).toString()).toBe("%PDF-");
    const two = [
      snapshot(),
      toInvoiceSnapshot(row({ invoiceNo: "AV-2609-000002", amountFc: 25_000 }), NOW),
    ];
    const batch = await renderInvoiceBatchPdf(two, "sept. 2026");
    const raw = batch.toString("latin1");
    expect(raw.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(2);
    const empty = await renderInvoiceBatchPdf([], "sept. 2026");
    expect(empty.subarray(0, 5).toString()).toBe("%PDF-");
    expect(empty.toString("latin1").match(/\/Type \/Page\b(?!s)/g)).toHaveLength(1);
  });
});
