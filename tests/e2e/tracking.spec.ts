import { expect, test, type Page } from "@playwright/test";

/**
 * Needs the seeded local stack (AG-KAM-007 in Bel-Air, mock provider, `pnpm db:seed` run today so
 * the morning trail exists for the current business day).
 */
const FAR_FROM_BEL_AIR = { latitude: -11.9, longitude: 27.9 };
const BEL_AIR = { latitude: -11.6642, longitude: 27.493 };
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Lubumbashi2026!";

test.use({
  viewport: { width: 390, height: 780 },
  geolocation: FAR_FROM_BEL_AIR,
  permissions: ["geolocation"],
});

async function loginAgent(page: Page) {
  await page.goto("/agent/login");
  await page.getByLabel("Matricule agent").fill("AG-KAM-007");
  await page.getByLabel("Code PIN").fill("123456");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/agent$/);
}

async function loginAdmin(page: Page, email: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/admin(\?|$)/);
}

test("outside Bel-Air the collection is refused in French; inside it goes through; the Superviseur reads the trail", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120_000);
  await loginAgent(page);

  // 51 km from Bel-Air: the request never reaches the provider, the agent reads why.
  await page.goto("/agent/encaisser/LUB-KAM-00000126");
  await expect(page.getByText("Canal de paiement")).toBeVisible();
  await page.getByRole("button", { name: /M-Pesa/ }).click();
  await page.getByRole("button", { name: "Envoyer la demande de paiement" }).click();
  await expect(
    page.getByText(/Encaissement refusé : vous êtes hors de votre zone \(Bel-Air\), à \d+ m/),
  ).toBeVisible();
  await expect(page.getByText("Demande envoyée")).toHaveCount(0);

  // Back in the quartier: a fresh household (the seeded balances stay untouched) is collected.
  await context.setGeolocation(BEL_AIR);
  await page.goto("/agent/recenser");
  await page.getByLabel("Nom complet").fill(`E2E Géorepérage ${Date.now()}`);
  await page
    .getByLabel("Téléphone (pour le reçu SMS)")
    .fill(`+24397${String(Date.now()).slice(-7)}`);
  await page.getByLabel("Adresse").fill("Av. Kasaï 1001");
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByText(/précision \d+ m/)).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer le contribuable" }).click();
  await expect(page.getByText("Contribuable enregistré")).toBeVisible();
  await page.getByRole("link", { name: "Encaisser maintenant" }).click();
  await expect(page.getByText("Canal de paiement")).toBeVisible();
  await page.getByRole("button", { name: /M-Pesa/ }).click();
  await page.getByRole("button", { name: "Envoyer la demande de paiement" }).click();
  await expect(page.getByText("Demande envoyée")).toBeVisible();
  await expect(page.getByText("Paiement reçu")).toBeVisible({ timeout: 20_000 });

  // The Superviseur sees the day: tiles, fence circle, trail, timeline with today's acts.
  const admin = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dash = await admin.newPage();
  await loginAdmin(dash, "ilunga.m@lubumbashi.cd");
  await dash.goto("/admin/agents");
  await expect(dash.getByRole("heading", { name: "Agents de terrain" })).toBeVisible();
  const row = dash.getByRole("row", { name: /AG-KAM-007/ });
  await expect(
    row.getByText(/aujourd’hui : dernier signal \d{2}:\d{2} · [\d,]+ km · \d+ acte/),
  ).toBeVisible();
  await row.getByRole("link", { name: "Activité" }).click();
  await expect(dash).toHaveURL(/\/admin\/agents\/AG-KAM-007$/);
  await expect(dash.getByRole("heading", { name: "Activité · AG-KAM-007" })).toBeVisible();
  await expect(dash.getByText("Zone autorisée : Bel-Air (rayon 1500 m)")).toBeVisible();
  for (const tile of ["Premier signal", "Dernier signal", "Temps actif", "Distance parcourue"]) {
    await expect(dash.getByText(tile, { exact: true })).toBeVisible();
  }
  const map = dash.getByTestId("activity-map");
  await expect(map.locator(".leaflet-container")).toBeVisible();
  await expect(map.getByTitle("Zoom avant")).toBeVisible();
  await expect(map.locator("path.activity-trail")).toHaveCount(1);
  expect(await map.locator(".trail-icon").count()).toBeGreaterThan(20);
  await expect(dash.getByRole("cell", { name: "Encaissement refusé" }).first()).toBeVisible();
  await expect(dash.getByRole("cell", { name: "Encaissement", exact: true }).first()).toBeVisible();
  await expect(dash.getByRole("cell", { name: "LUB-KAM-00000126" }).first()).toBeVisible();

  // Yesterday is empty for the seed but the screen still stands.
  await dash.getByRole("link", { name: /Jour précédent/ }).click();
  await expect(dash.getByRole("heading", { name: "Activité · AG-KAM-007" })).toBeVisible();
  await expect(dash.getByRole("link", { name: "Aujourd’hui" })).toBeVisible();

  // The coverage map draws each agent's last position on request.
  await dash.goto("/admin/carte?agents=1");
  await expect(dash.getByRole("heading", { name: /^Carte · / })).toBeVisible();
  await expect(dash.getByTestId("coverage-map").locator(".agent-icon").first()).toBeVisible();
  await admin.close();
});

test.describe("Finances cannot read the trail", () => {
  test("the activity page redirects to the forbidden screen", async ({ page }) => {
    await loginAdmin(page, "ngoy.k@lubumbashi.cd");
    await page.goto("/admin/agents/AG-KAM-007");
    await expect(page).toHaveURL(/\/admin\/interdit/);
  });
});
