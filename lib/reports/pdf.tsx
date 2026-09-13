import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import { formatDateTimeFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";

const styles = StyleSheet.create({
  page: { padding: 32, fontFamily: "Helvetica", fontSize: 9, color: "#1B1B1F" },
  city: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  title: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 4 },
  sub: { fontSize: 9, color: "#5C5456", marginBottom: 10 },
  section: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4 },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#EFEAEA",
    paddingVertical: 3,
  },
  head: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#C9C2C2",
    paddingVertical: 3,
  },
  headCell: { fontFamily: "Helvetica-Bold", color: "#5C5456", fontSize: 8 },
  cell: { paddingRight: 4 },
  right: { textAlign: "right" },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 32,
    right: 32,
    fontSize: 7,
    color: "#5C5456",
    textAlign: "center",
  },
});

export interface PdfColumn {
  header: string;
  key: string;
  /** Relative width (flex). */
  width?: number;
  align?: "left" | "right";
}

export interface PdfSection {
  title: string;
  columns: PdfColumn[];
  rows: Array<Record<string, string | number | null | undefined>>;
  /** Optional totals line rendered like a row. */
  total?: Record<string, string | number | null | undefined>;
}

/** A4 portrait tabular report: city header, title, sections of tables, generated-at footer. */
export async function tablePdf(
  title: string,
  subtitle: string,
  sections: PdfSection[],
  now = new Date(),
): Promise<Buffer> {
  const doc = (
    <Document title={title} author="Ville de Lubumbashi">
      <Page size="A4" style={styles.page}>
        <Text style={styles.city}>{t.receipt.city}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{subtitle}</Text>
        {sections.map((s) => (
          <View key={s.title}>
            <Text style={styles.section}>{s.title}</Text>
            <View style={styles.head}>
              {s.columns.map((c) => (
                <Text
                  key={c.key}
                  style={[
                    styles.cell,
                    styles.headCell,
                    { flex: c.width ?? 1 },
                    c.align === "right" ? styles.right : {},
                  ]}
                >
                  {c.header}
                </Text>
              ))}
            </View>
            {s.rows.map((r, i) => (
              <View key={i} style={styles.row} wrap={false}>
                {s.columns.map((c) => (
                  <Text
                    key={c.key}
                    style={[
                      styles.cell,
                      { flex: c.width ?? 1 },
                      c.align === "right" ? styles.right : {},
                    ]}
                  >
                    {r[c.key] === null || r[c.key] === undefined ? "" : String(r[c.key])}
                  </Text>
                ))}
              </View>
            ))}
            {s.total ? (
              <View style={styles.row}>
                {s.columns.map((c) => (
                  <Text
                    key={c.key}
                    style={[
                      styles.cell,
                      { flex: c.width ?? 1, fontFamily: "Helvetica-Bold" },
                      c.align === "right" ? styles.right : {},
                    ]}
                  >
                    {s.total![c.key] === null || s.total![c.key] === undefined
                      ? ""
                      : String(s.total![c.key])}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        ))}
        <Text style={styles.footer} fixed>
          {t.receipt.city} · {formatDateTimeFr(now)}
        </Text>
      </Page>
    </Document>
  );
  return Buffer.from(await renderToBuffer(doc));
}
