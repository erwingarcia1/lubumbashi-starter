import { formatDateFr, formatFC } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";

/**
 * SMS bodies (invariant 8: the copy lives in lib/i18n/fr.ts). GSM-7 friendly where possible:
 * amounts use a normal space instead of U+00A0 so a message stays in one segment.
 */
export type TemplateKey =
  "registration" | "portal_link" | "payment_confirmed" | "reminder" | "receipt";

export interface TemplateInput {
  registration: { taxpayerNo: string; fullName: string; portalUrl?: string };
  portal_link: { taxpayerNo: string; portalUrl: string };
  payment_confirmed: { amountFc: number; reference: string };
  reminder: { amountFc: number; dueDate: string; portalUrl: string };
  receipt: { receiptNo: string; amountFc: number; verifyUrl: string };
}

const fc = (n: number) => formatFC(n).replace(/ /g, " ");

export function renderTemplate<K extends TemplateKey>(key: K, input: TemplateInput[K]): string {
  const S = t.sms;
  switch (key) {
    case "registration": {
      const i = input as TemplateInput["registration"];
      const base = `${S.header} ${S.registration.replace("{id}", i.taxpayerNo)}`;
      return i.portalUrl ? `${base} ${S.portalLink} ${i.portalUrl}` : base;
    }
    case "portal_link": {
      const i = input as TemplateInput["portal_link"];
      return `${S.header} ${S.portalLinkBody.replace("{id}", i.taxpayerNo)} ${S.portalLink} ${i.portalUrl}`;
    }
    case "payment_confirmed": {
      const i = input as TemplateInput["payment_confirmed"];
      return `${S.header} ${S.paymentConfirmed.replace("{amount}", fc(i.amountFc)).replace("{ref}", i.reference)}`;
    }
    case "reminder": {
      const i = input as TemplateInput["reminder"];
      return `${S.header} ${S.reminder.replace("{amount}", fc(i.amountFc)).replace("{due}", formatDateFr(i.dueDate))} ${S.portalLink} ${i.portalUrl}`;
    }
    case "receipt": {
      const i = input as TemplateInput["receipt"];
      return `${S.header} ${S.receipt.replace("{no}", i.receiptNo).replace("{amount}", fc(i.amountFc))} ${S.verifyLink} ${i.verifyUrl}`;
    }
  }
}
