import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

loadEnvConfig(process.cwd(), true);

/**
 * Needs the seeded stack: LUB-KAM-00000127 (Banza Mutombo Eric, one household entity). The note is
 * created for a random far-future month, so the run is repeatable on a shared database, and the
 * obligation is removed afterwards when the database is reachable.
 */
async function login(page: Page, email: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto("/admin/login");
    await page.getByLabel("Adresse e-mail").fill(email);
    await page
      .getByLabel("Mot de passe")
      .fill(process.env.SEED_ADMIN_PASSWORD ?? "Lubumbashi2026!");
    await page.getByRole("button", { name: "Se connecter" }).click();
    const landed = await page
      .waitForURL(/\/admin(\?|$)/, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (landed) return;
  }
  await expect(page).toHaveURL(/\/admin(\?|$)/);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/admin\/login/);
}

const TAXPAYER = "LUB-KAM-00000127";
/** `formatFC` as the screen prints it (no-break spaces, U+00A0). */
const fc = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0")}\u00a0FC`;
const YEAR = 2100 + Math.floor(Math.random() * 800);
const MONTH = `${YEAR}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}`;
const createdNotes: string[] = [];

test.afterAll(async () => {
  if (!process.env.DATABASE_URL || createdNotes.length === 0) return;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("delete from app.obligations where invoice_no = any($1::text[])", [
      createdNotes,
    ]);
  } finally {
    await client.end();
  }
});

test("the Maire creates a new note de perception for a chosen taxpayer with her own details and prints it at once; the Auditeur has no card", async ({
  page,
}) => {
  test.setTimeout(process.env.PLAYWRIGHT_BASE_URL ? 300_000 : 120_000);

  await login(page, "maire@lubumbashi.cd");
  await page.locator('nav a[href="/admin/notes-de-perception"]').click();
  await expect(page.getByRole("heading", { name: "Notes de perception" })).toBeVisible();
  await page.getByLabel("Rechercher un contribuable").fill("Banza");
  await page.getByRole("button", { name: "Rechercher" }).click();
  await page
    .getByRole("row", { name: new RegExp(TAXPAYER) })
    .getByRole("link", { name: /Choisir/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`contribuable=${TAXPAYER}`));
  await expect(page.getByText("Contribuable choisi")).toBeVisible();

  // The card sits above the existing notes, with the entity and the tax preselected.
  const card = page.locator("#nouvelle");
  await expect(card.getByText("Nouvelle note de perception")).toBeVisible();
  await expect(page.getByText("Notes existantes")).toBeVisible();
  const entity = card.getByLabel("Bien ou activité");
  await expect(entity).toHaveValue(/.+/);
  await expect(entity.locator("option:checked")).toHaveText(/Résidence Av. Lumumba 87 · Ménage/);
  const tax = card.getByLabel("Taxe", { exact: true });
  // Only the rules that apply to the entity are offered: no Commerce rule for a household.
  await expect(tax.locator("option", { hasText: "Ménage" })).toHaveCount(1);
  await expect(tax.locator("option", { hasText: "Commerce" })).toHaveCount(0);
  await tax.selectOption({ label: "Taxe d’assainissement · Ménage" });
  const amount = card.getByLabel("Montant (FC)");
  await expect(amount).toHaveValue("5000");
  await expect(card.getByText("Barème : 5 000 FC")).toBeVisible();
  await expect(card.getByLabel("Motif de l’écart")).toHaveCount(0);
  const submit = card.getByRole("button", { name: "Créer et générer la note" });

  // The month cannot precede the registration month (Banza was registered on 2026-09-03): the
  // input starts there and an earlier month is refused inline, button greyed.
  const monthInput = card.getByLabel("Période (mois)");
  await expect(monthInput).toHaveAttribute("min", "2026-09");
  await monthInput.fill("2026-08");
  await expect(card.getByText(/Bien enregistré en sept\. 2026/)).toBeVisible();
  await expect(submit).toBeDisabled();

  // A far-future month, typed; the due date and the amount follow that month's barème (another
  // version may be in force there on a shared database), and no reason is asked.
  await monthInput.fill(MONTH);
  await expect(card.getByText(/Bien enregistré en/)).toHaveCount(0);
  await expect(monthInput).toHaveValue(MONTH);
  const dueDate = card.getByLabel("Échéance");
  await expect(dueDate).toHaveValue(new RegExp(`^${MONTH}-(28|29|30|31)$`));
  await expect(amount).toHaveValue(/^\d+$/);
  const prefilled = Number(await amount.inputValue());
  await expect(card.getByText(`Barème : ${fc(prefilled)}`)).toBeVisible();
  await expect(card.getByLabel("Motif de l’écart")).toHaveCount(0);
  await card.getByLabel("Objet (facultatif)").fill("Note E2E");
  await expect(submit).toBeEnabled();
  await submit.click();

  // Landed back on the screen: green banner with the number and the PDF link; the row is issued.
  // The action creates, issues and re-renders the screen: a busy dev server needs more than the
  // default 5 s (another flow may be rendering a print run at the same time).
  await expect(page).toHaveURL(new RegExp(`contribuable=${TAXPAYER}.*note=AV-\\d{4}-\\d{6}`), {
    timeout: 30_000,
  });
  const invoiceNo = /AV-\d{4}-\d{6}/.exec(page.url())![0];
  createdNotes.push(invoiceNo);
  const banner = page.getByText(`créée et émise`).locator("..");
  await expect(banner).toContainText(`Note ${invoiceNo} créée et émise.`);
  const open = page.getByRole("link", { name: "Ouvrir la note (PDF)" });
  await expect(open).toHaveAttribute("href", `/api/v1/admin/invoices/${invoiceNo}/pdf`);
  await expect(open).toHaveAttribute("target", "_blank");
  const pdf = await page.request.get(`/api/v1/admin/invoices/${invoiceNo}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const row = page.locator("tr", { hasText: invoiceNo });
  await expect(row).toContainText(/émise le \d{2}\/\d{2}\/\d{4}/);
  await expect(row).toContainText(fc(prefilled));

  // The same month again: refused with the existing number, linked; nothing new is created.
  await card.getByLabel("Période (mois)").fill(MONTH);
  await card.getByRole("button", { name: "Créer et générer la note" }).click();
  const alert = card.locator('[role="alert"]');
  await expect(alert).toContainText(
    "Une note existe déjà pour ce bien, cette taxe et cette période",
    { timeout: 30_000 },
  );
  await expect(alert).toContainText(invoiceNo);
  await expect(alert.getByRole("link", { name: "Ouvrir la note (PDF)" })).toHaveAttribute(
    "href",
    `/api/v1/admin/invoices/${invoiceNo}/pdf`,
  );
  await expect(page.locator("tr", { hasText: invoiceNo })).toHaveCount(1);

  // The journal has the creation and the issue, both by her.
  await page.goto(`/admin/audit?action=obligation.created&object=${invoiceNo}`);
  await expect(page.getByText(invoiceNo).first()).toBeVisible();
  await expect(page.getByText("maire@lubumbashi.cd").first()).toBeVisible();
  await page.goto(`/admin/audit?action=invoice.issued&object=${invoiceNo}`);
  await expect(page.getByText(invoiceNo).first()).toBeVisible();

  // The taxpayer page links to the card.
  await page.goto(`/admin/contribuables/${TAXPAYER}`);
  await expect(page.getByRole("link", { name: "Nouvelle note de perception" })).toHaveAttribute(
    "href",
    `/admin/notes-de-perception?contribuable=${TAXPAYER}#nouvelle`,
  );
  await signOut(page);

  // The Auditeur: no screen, no card, no link.
  await login(page, "auditeur@lubumbashi.cd");
  await page.goto(`/admin/notes-de-perception?contribuable=${TAXPAYER}`);
  await expect(page).toHaveURL(/\/admin\/interdit$/);
  await expect(page.getByText("Nouvelle note de perception")).toHaveCount(0);
  await page.goto(`/admin/contribuables/${TAXPAYER}`);
  await expect(page.getByRole("heading", { name: "Banza Mutombo Eric" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nouvelle note de perception" })).toHaveCount(0);
});
