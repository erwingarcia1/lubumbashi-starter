import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";

import { formatDateTimeFr, formatFC, formatMonthFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";

import type { ReceiptSnapshot } from "./issue";

const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: "Helvetica", fontSize: 11, color: "#1B1B1F" },
  header: {
    textAlign: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#E3DEDE",
    paddingBottom: 8,
    marginBottom: 10,
  },
  city: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 10, color: "#5C5456" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#EFEAEA",
    paddingVertical: 5,
  },
  key: { color: "#5C5456" },
  val: { fontFamily: "Helvetica-Bold" },
  mono: { fontFamily: "Courier" },
  cancelled: {
    color: "#B3261E",
    fontFamily: "Helvetica-Bold",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 8,
  },
  qr: { width: 110, height: 110, alignSelf: "center", marginTop: 14 },
  verify: { fontSize: 9, color: "#5C5456", textAlign: "center", marginTop: 6 },
});

export function receiptPeriodLabel(a: ReceiptSnapshot["allocations"][number]): string {
  const start = formatMonthFr(a.periodStart);
  const end = formatMonthFr(a.periodEnd);
  return start === end ? start : `${start} → ${end}`;
}

/** Built-in Helvetica/Courier cover French Latin-1 (accents, U+00A0); no runtime font fetch. */
export async function renderReceiptPdf(
  snapshot: ReceiptSnapshot,
  verifyUrl: string,
  status: "issued" | "cancelled",
): Promise<Buffer> {
  const qr = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 220 });
  const R = t.receipt;
  const rows: Array<[string, string, boolean]> = [
    [R.number, snapshot.receiptNo, true],
    [R.taxpayer, snapshot.taxpayerName, false],
    [R.id, snapshot.taxpayerNo, true],
    [
      R.period,
      snapshot.allocations
        .map(
          (a) =>
            `${a.ruleLabelFr} · ${receiptPeriodLabel(a)}${a.kind === "penalty" ? ` (${R.penalty})` : ""}`,
        )
        .join(" ; ") || "—",
      false,
    ],
    [R.amount, formatFC(snapshot.amountFc), true],
    [
      R.channel,
      `${t.status.channel[snapshot.channel as keyof typeof t.status.channel] ?? snapshot.channel} · ${snapshot.providerReference}`,
      true,
    ],
    [R.date, formatDateTimeFr(new Date(snapshot.issuedAt)), true],
  ];
  if (snapshot.agentMatricule) rows.push([R.agent, snapshot.agentMatricule, true]);
  const doc = (
    <Document title={`${snapshot.receiptNo}`} author={R.city} language="fr">
      <Page size="A5" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.city}>{R.city}</Text>
          <Text style={styles.sub}>{R.official}</Text>
        </View>
        {status === "cancelled" ? <Text style={styles.cancelled}>{R.cancelled}</Text> : null}
        {rows.map(([k, v, mono]) => (
          <View key={k} style={styles.row}>
            <Text style={styles.key}>{k}</Text>
            <Text style={mono ? [styles.val, styles.mono] : styles.val}>{v}</Text>
          </View>
        ))}
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
        <Image style={styles.qr} src={qr} />
        <Text style={styles.verify}>
          {R.verify} {verifyUrl}
        </Text>
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
