import { expect, test, type Page } from "@playwright/test";

/**
 * Needs the seeded stack (admin accounts). The flow creates its own taxpayer from the back office
 * (Administrateur), so it holds on a shared database and against the demo server alike, and it
 * leaves nothing but that demo household behind.
 */
async function login(page: Page, email: string) {
  // One retry: several flows logging in at once can hit a transient auth hiccup locally.
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
  // The sign-out action must finish before another login, or its response clears the new cookie.
  await expect(page).toHaveURL(/\/admin\/login/);
}

const ROUTE = "/api/v1/admin/invoices/pdf";

test("the Maire generates the note de perception of a chosen taxpayer from the dashboard; the Auditeur has no entry", async ({
  page,
}) => {
  test.setTimeout(process.env.PLAYWRIGHT_BASE_URL ? 300_000 : 120_000);

  // A fresh household registered at the counter: its first obligation is open and not issued.
  await login(page, "admin@lubumbashi.cd");
  await page.goto("/admin/contribuables/nouveau");
  const name = `E2E Note ${Date.now()}`;
  await page.getByLabel("Nom complet").fill(name);
  await page
    .getByLabel("Téléphone (pour le reçu SMS)")
    .fill(`+24396${String(Date.now()).slice(-7)}`);
  await page.getByLabel("Adresse").fill("Av. de la Note 3");
  await page.getByLabel("Quartier").selectOption({ label: "Bel-Air" });
  await page.getByLabel("Catégorie fiscale").selectOption({ label: "Ménage" });
  const map = page.getByTestId("position-picker").locator(".leaflet-container");
  await expect(map).toBeVisible();
  await map.click({ position: { x: 200, y: 130 } });
  await page.getByRole("button", { name: "Utiliser ce point" }).click();
  await page.getByRole("button", { name: "Enregistrer le contribuable" }).click();
  await expect(page).toHaveURL(/\/admin\/contribuables\/LUB-KAM-\d{8}\?ok=created$/);
  const TAXPAYER = /LUB-KAM-\d{8}/.exec(page.url())![0];
  const noteLink = page.locator('a[href^="/api/v1/admin/invoices/AV-"]').first();
  await expect(noteLink).toBeVisible();
  const invoiceNo = /AV-\d{4}-\d{6}/.exec((await noteLink.getAttribute("href")) ?? "")![0];
  await signOut(page);

  await login(page, "maire@lubumbashi.cd");
  await page.locator('nav a[href="/admin/notes-de-perception"]').click();
  // Navigations wait on the dev server, which another flow (the September print run of
  // invoices.spec.ts, hundreds of PDF pages) can block for seconds: give them the remote budget.
  await expect(page).toHaveURL(/\/admin\/notes-de-perception$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Notes de perception" })).toBeVisible();
  await expect(page.getByText("Impression groupée du mois")).toBeVisible();

  // Search, then choose the taxpayer.
  await page.getByLabel("Rechercher un contribuable").fill(name);
  await page.getByRole("button", { name: "Rechercher" }).click();
  await expect(page).toHaveURL(/q=E2E/);
  const result = page.getByRole("row", { name: new RegExp(TAXPAYER) });
  await expect(result).toContainText(name);
  await expect(result).toContainText("Kampemba");
  await result.getByRole("link", { name: /Choisir/ }).click();
  await expect(page).toHaveURL(new RegExp(`contribuable=${TAXPAYER}`));
  await expect(page.getByText("Contribuable choisi")).toBeVisible();
  await expect(page.getByText(name).first()).toBeVisible();

  // Its open obligations are listed and checked; the form carries their ids in one field.
  const boxes = page.locator('input[type="checkbox"][data-obligation]');
  expect(await boxes.count()).toBeGreaterThan(0);
  for (const box of await boxes.all()) await expect(box).toBeChecked();
  const form = page.locator(`form[action="${ROUTE}"]`);
  await expect(form).toHaveAttribute("target", "_blank");
  const button = form.getByRole("button", { name: "Générer la note de perception" });
  await expect(button).toBeEnabled();
  await expect(page.getByText("Le PDF s’ouvre dans un nouvel onglet.")).toBeVisible();
  const ids = await form.locator('input[name="obligations"]').inputValue();
  expect(ids.split(",").length).toBeGreaterThan(0);
  const href = `${ROUTE}?obligations=${ids}`;
  // On a shared server another flow (the September print run of invoices.spec.ts) may issue this
  // note first: the journal then names that user, and only the first issue is the Maire's.
  const issuedBefore = /émise le \d{2}\/\d{2}\/\d{4}/.test(
    (await page.locator("tr", { hasText: invoiceNo }).textContent()) ?? "",
  );

  // Unchecking everything greys the button; re-checking restores the ids.
  const first = boxes.first();
  for (const box of await boxes.all()) await box.uncheck();
  await expect(button).toBeDisabled();
  await expect(page.getByText("Cochez au moins une obligation.")).toBeVisible();
  for (const box of await boxes.all()) await box.check();
  await expect(button).toBeEnabled();
  await expect(first).toBeChecked();
  expect(await form.locator('input[name="obligations"]').inputValue()).toBe(ids);

  // The submit opens the PDF in a new tab (headless Chromium turns it into a download): the
  // navigation response is the combined note itself.
  const responsePromise = page
    .context()
    .waitForEvent(
      "response",
      (r) => r.url().includes(`${ROUTE}?`) && r.request().isNavigationRequest(),
    );
  await button.click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  const direct = await page.request.get(href);
  expect(direct.status()).toBe(200);
  expect(direct.headers()["content-type"]).toContain("application/pdf");
  expect(direct.headers()["content-disposition"]).toContain(
    `inline; filename="notes-${TAXPAYER}.pdf"`,
  );
  expect((await direct.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // The screen and the taxpayer page now show the first issue; the record has the same button.
  await page.reload();
  await expect(page.getByText(/émise le \d{2}\/\d{2}\/\d{4}/).first()).toBeVisible();
  await page.getByRole("link", { name: "Ouvrir la fiche" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/contribuables/${TAXPAYER}$`), {
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name })).toBeVisible();
  const issuedRow = page.locator("tr", {
    has: page.locator(`a[href="/api/v1/admin/invoices/${invoiceNo}/pdf"]`),
  });
  await expect(issuedRow).toContainText(/émise le \d{2}\/\d{2}\/\d{4}/);
  const all = page.getByRole("link", { name: "Générer la note de perception" });
  await expect(all).toHaveAttribute("href", new RegExp(`^${ROUTE}\\?obligations=`));
  await expect(all).toHaveAttribute("target", "_blank");
  await page.goto(`/admin/audit?action=invoice.issued&object=${invoiceNo}`);
  await expect(page.getByText(invoiceNo).first()).toBeVisible();
  if (!issuedBefore) await expect(page.getByText("maire@lubumbashi.cd").first()).toBeVisible();
  await signOut(page);

  // The Auditeur has no menu entry, the page refuses him, and so does the API.
  await login(page, "auditeur@lubumbashi.cd");
  await expect(page.locator('nav a[href="/admin/contribuables"]')).toBeVisible();
  await expect(page.locator('nav a[href="/admin/notes-de-perception"]')).toHaveCount(0);
  await page.goto("/admin/notes-de-perception");
  await expect(page).toHaveURL(/\/admin\/interdit$/);
  await expect(page.getByRole("heading", { name: "Accès refusé" })).toBeVisible();
  expect((await page.request.get(href)).status()).toBe(403);
  await page.goto(`/admin/contribuables/${TAXPAYER}`);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByRole("link", { name: "Générer la note de perception" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Note de perception" })).toHaveCount(0);
});
