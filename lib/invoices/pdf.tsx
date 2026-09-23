import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";

import { formatDateFr, formatDateTimeFr, formatFC, formatMonthFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";

import type { InvoiceSnapshot } from "./snapshot";

/**
 * Layout of the note de perception (A4 portrait, built-in Helvetica/Courier, no font fetch).
 * The Mairie's official model replaces THIS FILE ONLY: bump NOTE_TEMPLATE_VERSION when it
 * lands (the version is printed in the footer and recorded in every `invoice.issued` audit row).
 */
// DECISION-PENDING: D35 — placeholder layout, legal mentions and signature block until the official model arrives.
export const NOTE_TEMPLATE_VERSION = "placeholder-1";

const INK = "#1B1B1F";
const MUTED = "#5C5456";
const LINE = "#E3DEDE";
const RED = "#C1121F";

const styles = StyleSheet.create({
  page: { padding: 40, paddingBottom: 56, fontFamily: "Helvetica", fontSize: 10, color: INK },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: RED,
    paddingBottom: 10,
    marginBottom: 14,
  },
  city: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  authority: { fontSize: 9, color: MUTED, marginTop: 2 },
  title: { fontSize: 17, fontFamily: "Helvetica-Bold", color: RED, textAlign: "right" },
  number: { fontFamily: "Courier-Bold", fontSize: 12, textAlign: "right", marginTop: 4 },
  hint: { fontSize: 8, color: MUTED, textAlign: "right" },
  stamp: {
    alignSelf: "center",
    borderWidth: 2,
    borderColor: "#1E7A46",
    color: "#1E7A46",
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    paddingVertical: 4,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  columns: { flexDirection: "row", gap: 14 },
  block: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 8 },
  blockTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: MUTED,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#EFEAEA",
    paddingVertical: 3,
  },
  key: { color: MUTED, flexShrink: 0 },
  val: { fontFamily: "Helvetica-Bold", textAlign: "right", flexShrink: 1 },
  mono: { fontFamily: "Courier-Bold" },
  amounts: { marginTop: 14, borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 8 },
  amountRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#EFEAEA",
    paddingVertical: 4,
  },
  outstandingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 6,
  },
  outstandingKey: { fontFamily: "Helvetica-Bold", fontSize: 12 },
  outstandingVal: { fontFamily: "Courier-Bold", fontSize: 16, color: RED },
  asOf: { fontSize: 8, color: MUTED, marginTop: 4 },
  howToPay: { marginTop: 12, fontSize: 9.5, lineHeight: 1.4 },
  qrRow: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 14 },
  qr: { width: 104, height: 104 },
  verify: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  url: { fontFamily: "Courier", fontSize: 8.5, marginTop: 2 },
  scan: { fontSize: 8.5, color: MUTED, marginTop: 4 },
  legal: { marginTop: 14, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8 },
  legalTitle: { fontFamily: "Helvetica-Bold", fontSize: 8.5, color: MUTED, marginBottom: 2 },
  legalBody: { fontSize: 8, color: MUTED, lineHeight: 1.35 },
  signature: { flexDirection: "row", justifyContent: "space-between", marginTop: 18, gap: 14 },
  signatureText: { flex: 1, fontSize: 9, color: MUTED, lineHeight: 1.4 },
  signatureBox: {
    width: 190,
    height: 64,
    borderWidth: 1,
    borderColor: "#C9C2C2",
    borderStyle: "dashed",
    justifyContent: "flex-end",
    padding: 4,
  },
  signatureLine: { fontSize: 8, color: MUTED, textAlign: "center" },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 40,
    right: 40,
    fontSize: 7.5,
    color: MUTED,
    textAlign: "center",
  },
});

const I = t.admin.invoices;

function periodLabel(s: InvoiceSnapshot): string {
  const start = formatMonthFr(s.periodStart);
  const end = formatMonthFr(s.periodEnd);
  return start === end ? start : I.periodFromTo.replace("{from}", start).replace("{to}", end);
}

function issuerLabel(s: InvoiceSnapshot): string {
  if (!s.issuedAt) return "";
  const who = s.issuedBySystem ? I.systemIssuer : (s.issuedBy ?? I.systemIssuer);
  return `${I.issuedBy} ${who} · ${I.issuedOn} ${formatDateFr(new Date(s.issuedAt))}`;
}

function Block({ title, rows }: { title: string; rows: Array<[string, string, boolean?]> }) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>{title}</Text>
      {rows.map(([k, v, mono]) => (
        <View key={k} style={styles.row}>
          <Text style={styles.key}>{k}</Text>
          <Text style={mono ? [styles.val, styles.mono] : styles.val}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

/** One note = one page. `qr` is the data URL of the verification link's QR. */
function NotePage({ s, qr }: { s: InvoiceSnapshot; qr: string }) {
  const settled = s.status === "paid" || s.outstandingFc === 0;
  const printed = new Date(s.printedAt);
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.city}>{I.city}</Text>
          <Text style={styles.authority}>{I.authority}</Text>
        </View>
        <View>
          <Text style={styles.title}>{I.title}</Text>
          <Text style={styles.number}>
            {I.number} {s.invoiceNo}
          </Text>
          <Text style={styles.hint}>{I.numberHint}</Text>
        </View>
      </View>
      {settled ? <Text style={styles.stamp}>{I.settled}</Text> : null}
      <View style={styles.columns}>
        <Block
          title={I.taxpayer}
          rows={[
            [I.taxpayer, s.taxpayer.fullName],
            [I.id, s.taxpayer.taxpayerNo, true],
            [I.phone, s.taxpayer.phone, true],
            [I.address, s.taxpayer.address],
            [I.commune, s.quartier ? `${s.commune} · ${s.quartier}` : s.commune],
          ]}
        />
        <Block
          title={I.entity}
          rows={[
            [I.entity, s.entity.name],
            [I.address, s.entity.address],
            [I.category, s.entity.categoryLabel],
            [I.tax, s.tax.label],
            [I.period, periodLabel(s)],
            [I.due, formatDateFr(s.dueDate), true],
          ]}
        />
      </View>
      <View style={styles.amounts}>
        {(
          [
            [I.principal, s.amountFc],
            [I.penalty, s.penaltyFc],
            [I.total, s.amountFc + s.penaltyFc],
            [I.paid, s.paidFc],
          ] as Array<[string, number]>
        ).map(([k, v]) => (
          <View key={k} style={styles.amountRow}>
            <Text style={styles.key}>{k}</Text>
            <Text style={styles.mono}>{formatFC(v)}</Text>
          </View>
        ))}
        <View style={styles.outstandingRow}>
          <Text style={styles.outstandingKey}>{I.outstanding}</Text>
          <Text style={styles.outstandingVal}>{formatFC(s.outstandingFc)}</Text>
        </View>
        <Text style={styles.asOf}>{I.amountsAsOf.replace("{date}", formatDateFr(printed))}</Text>
      </View>
      <Text style={styles.howToPay}>{I.howToPay}</Text>
      <View style={styles.qrRow}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
        <Image style={styles.qr} src={qr} />
        <View style={{ flex: 1 }}>
          <Text style={styles.verify}>{I.verify}</Text>
          <Text style={styles.url}>{s.verificationUrl}</Text>
          <Text style={styles.scan}>{I.scan}</Text>
        </View>
      </View>
      <View style={styles.legal}>
        <Text style={styles.legalTitle}>{I.legalTitle}</Text>
        <Text style={styles.legalBody}>{I.legalPlaceholder}</Text>
      </View>
      <View style={styles.signature}>
        <View style={styles.signatureText}>
          <Text style={{ fontFamily: "Helvetica-Bold", color: INK }}>{I.signatureFor}</Text>
          <Text>{issuerLabel(s)}</Text>
        </View>
        <View style={styles.signatureBox}>
          <Text style={styles.signatureLine}>{I.signatureLine}</Text>
        </View>
      </View>
      <Text
        style={styles.footer}
        fixed
        render={({ pageNumber, totalPages }) =>
          `${I.template} ${NOTE_TEMPLATE_VERSION} · ${I.printedOn} ${formatDateTimeFr(printed)} · ${I.pageOf
            .replace("{n}", String(pageNumber))
            .replace("{total}", String(totalPages))}`
        }
      />
    </Page>
  );
}

async function qrOf(url: string): Promise<string> {
  return QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 220 });
}

/** A single note de perception as PDF (one page). */
export async function renderInvoicePdf(snapshot: InvoiceSnapshot): Promise<Buffer> {
  const qr = await qrOf(snapshot.verificationUrl);
  const doc = (
    <Document title={snapshot.invoiceNo} author={I.city} language="fr">
      <NotePage s={snapshot} qr={qr} />
    </Document>
  );
  return Buffer.from(await renderToBuffer(doc));
}

/** A print run: one page per note, in the order given; an empty run is a one-page notice. */
export async function renderInvoiceBatchPdf(
  snapshots: InvoiceSnapshot[],
  monthLabel: string,
): Promise<Buffer> {
  const title = I.batchTitle.replace("{month}", monthLabel);
  const qrs = await Promise.all(snapshots.map((s) => qrOf(s.verificationUrl)));
  const doc = (
    <Document title={title} author={I.city} language="fr">
      {snapshots.length === 0 ? (
        <Page size="A4" style={styles.page}>
          <Text style={styles.city}>{I.city}</Text>
          <Text style={styles.title}>{I.title}</Text>
          <Text style={styles.howToPay}>{I.batchEmpty.replace("{month}", monthLabel)}</Text>
        </Page>
      ) : (
        snapshots.map((s, i) => <NotePage key={s.invoiceNo} s={s} qr={qrs[i]!} />)
      )}
    </Document>
  );
  return Buffer.from(await renderToBuffer(doc));
}
