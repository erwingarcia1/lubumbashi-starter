import QRCode from "qrcode";

const ID_RE = /^LUB-[A-Z]{3}-\d{8}$/;

/** What the door sticker and the agent's screen encode: a portal URL that carries the ID. */
export function qrPayloadFor(
  taxpayerNo: string,
  appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "",
): string {
  return `${appUrl.replace(/\/$/, "")}/q/${taxpayerNo}`;
}

/** Accepts a bare ID, a portal URL, or a hardware scanner's typed string (with trailing Enter). */
export function parseScannedTaxpayerNo(raw: string): string | null {
  const s = raw.trim();
  if (ID_RE.test(s)) return s;
  const m = /\/q\/(LUB-[A-Z]{3}-\d{8})\b/.exec(s);
  return m ? m[1]! : null;
}

export async function qrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 1, width: 240 });
}
