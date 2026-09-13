import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { auditCsv, type AuditRow } from "@/lib/admin/audit";
import { tablePdf } from "@/lib/reports/pdf";
import { workbook } from "@/lib/reports/xlsx";

const row = (over: Partial<AuditRow> = {}): AuditRow => ({
  id: 1,
  at: new Date("2026-09-13T06:44:07Z"),
  actorType: "agent",
  actorLabel: "AG-KAM-007",
  actorRole: "agent",
  action: "payment.initiated",
  objectType: "payment",
  objectId: "TX-2609-13-0842-7K",
  details: { amountFc: 5000 },
  reason: null,
  gps: { x: 27.493, y: -11.6642 },
  ip: null,
  deviceCode: "DEV-3F9A",
  userAgent: null,
  ...over,
});

describe("exports (M10)", () => {
  it("audit CSV: BOM, header, RFC 4180 quoting of commas, quotes and newlines", () => {
    const csv = auditCsv([
      row(),
      row({
        id: 2,
        actorType: "admin",
        actorLabel: "ngoy.k@lubumbashi.cd",
        actorRole: "finances",
        reason: 'motif "urgent", ligne 2\nsuite',
        gps: null,
        ip: "41.243.1.2",
        deviceCode: null,
        userAgent: "Chrome/Windows",
      }),
    ]);
    expect(
      csv.startsWith(
        "﻿horodatage,acteur_type,acteur,role,action,objet_type,objet,motif,gps,ip,appareil,user_agent,details\r\n",
      ),
    ).toBe(true);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe(
      '2026-09-13T06:44:07.000Z,agent,AG-KAM-007,agent,payment.initiated,payment,TX-2609-13-0842-7K,,"-11.66420, 27.49300",,DEV-3F9A,,"{""amountFc"":5000}"',
    );
    expect(lines[2]).toContain('"motif ""urgent"", ligne 2\nsuite"');
    expect(lines[2]).toContain(",41.243.1.2,,Chrome/Windows,");
  });

  it("workbook: title, subtitle, header, integer amounts formatted by Excel (never floats)", async () => {
    const buf = await workbook(
      "Rapport de test",
      [
        { header: "Libellé", key: "label" },
        { header: "Montant (FC)", key: "amountFc", money: true },
      ],
      [{ label: "Kampemba", amountFc: 1486000 }],
      "Septembre 2026",
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getCell("A1").value).toBe("Rapport de test");
    expect(ws.getCell("A2").value).toBe("Septembre 2026");
    expect(ws.getCell("A4").value).toBe("Libellé");
    expect(ws.getCell("B5").value).toBe(1486000);
    expect(ws.getCell("B5").numFmt).toBe("#,##0");
  });

  it("tablePdf renders a PDF with the city header", async () => {
    const buf = await tablePdf(
      "Performance des agents",
      "Situation au 13/09/2026",
      [
        {
          title: "Agents",
          columns: [
            { header: "Agent", key: "agent", width: 2 },
            { header: "Montant", key: "amount", align: "right" },
          ],
          rows: [{ agent: "AG-KAM-007 · Kalenga Mbuyi", amount: "1 486 000 FC" }],
          total: { agent: "Total", amount: "1 486 000 FC" },
        },
      ],
      new Date("2026-09-13T10:00:00Z"),
    );
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  });
});
