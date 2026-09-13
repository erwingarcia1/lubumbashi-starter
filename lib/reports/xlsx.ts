import ExcelJS from "exceljs";

export interface Column {
  header: string;
  key: string;
  width?: number;
  /** Integer FC columns get a thousands separator and right alignment. */
  money?: boolean;
}

/** One-sheet workbook; amounts stay integers (invariant 9), formatted by Excel only. */
export async function workbook(
  title: string,
  columns: Column[],
  rows: Array<Record<string, unknown>>,
  subtitle?: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Ville de Lubumbashi";
  wb.created = new Date();
  const ws = wb.addWorksheet(title.slice(0, 31));
  ws.addRow([title]).font = { bold: true, size: 14 };
  if (subtitle) ws.addRow([subtitle]).font = { color: { argb: "FF5C5456" } };
  ws.addRow([]);
  const headerRow = ws.addRow(columns.map((c) => c.header));
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFECE7E7" } };
  for (const r of rows) {
    const row = ws.addRow(columns.map((c) => r[c.key] ?? null));
    columns.forEach((c, i) => {
      if (c.money) {
        const cell = row.getCell(i + 1);
        cell.numFmt = "#,##0";
        cell.alignment = { horizontal: "right" };
      }
    });
  }
  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width ?? Math.max(12, c.header.length + 2);
  });
  ws.views = [{ state: "frozen", ySplit: subtitle ? 4 : 3 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
