import { describe, expect, it } from "vitest";

import { renderNotification } from "@/lib/notify";
import { consoleProvider } from "@/lib/notify/providers/console";
import { renderTemplate } from "@/lib/notify/templates";

describe("SMS templates (invariant 8: copy from lib/i18n, GSM-friendly spaces)", () => {
  it("registration carries the ID and the portal link", () => {
    const s = renderTemplate("registration", {
      taxpayerNo: "LUB-KAM-00000125",
      fullName: "Mwamba Kasongo Jean",
      portalUrl: "https://x.cd/t/abc",
    });
    expect(s).toContain("LUB-KAM-00000125");
    expect(s).toContain("https://x.cd/t/abc");
    expect(s.startsWith("Ville de Lubumbashi :")).toBe(true);
  });

  it("registration without a link is still a complete sentence", () => {
    const s = renderTemplate("registration", { taxpayerNo: "LUB-KAM-00000125", fullName: "X" });
    expect(s.endsWith(".")).toBe(true);
    expect(s).not.toContain("undefined");
  });

  it("amounts use a plain space, never U+00A0 (one SMS segment)", () => {
    const s = renderTemplate("payment_confirmed", {
      amountFc: 10_000,
      reference: "TX-2609-13-0844-AB12",
    });
    expect(s).toContain("10 000 FC");
    expect(s).not.toContain(" ");
    expect(s).toContain("TX-2609-13-0844-AB12");
  });

  it("reminder and receipt", () => {
    expect(
      renderTemplate("reminder", { amountFc: 5000, dueDate: "2026-09-30", portalUrl: "u" }),
    ).toContain("30/09/2026");
    const r = renderTemplate("receipt", {
      receiptNo: "RCP-2609-000287",
      amountFc: 5000,
      verifyUrl: "https://x.cd/v/RCP-2609-000287/t",
    });
    expect(r).toContain("RCP-2609-000287");
    expect(r).toContain("https://x.cd/v/RCP-2609-000287/t");
    expect(
      renderTemplate("portal_link", { taxpayerNo: "LUB-KAM-00000125", portalUrl: "u" }),
    ).toContain("u");
  });

  it("renderNotification builds the verify URL from the receipt token and rejects unknown keys", () => {
    const body = renderNotification({
      templateKey: "receipt",
      payload: { receiptNo: "RCP-2609-000001", amountFc: 5000, verifyToken: "deadbeef" },
    });
    expect(body).toContain("/v/RCP-2609-000001/deadbeef");
    expect(() => renderNotification({ templateKey: "nope", payload: {} })).toThrow(
      /unknown template/,
    );
  });

  it("console provider prints and reports success", async () => {
    const lines: string[] = [];
    const r = await consoleProvider((l) => lines.push(l)).send({
      to: "+243994128830",
      body: "hi",
      reference: "n1",
    });
    expect(r.ok).toBe(true);
    expect(lines[0]).toContain("+243994128830");
    expect(lines[0]).toContain("hi");
  });
});
