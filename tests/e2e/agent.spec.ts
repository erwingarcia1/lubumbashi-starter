import { expect, test } from "@playwright/test";

/** Needs the seeded local stack (agents AG-KAM-007 with PIN 123456). */
test.use({
  ...{ viewport: { width: 390, height: 780 } },
  geolocation: { latitude: -11.6642, longitude: 27.493 },
  permissions: ["geolocation"],
});

async function loginAgent(page: import("@playwright/test").Page) {
  await page.goto("/agent/login");
  await page.getByLabel("Matricule agent").fill("AG-KAM-007");
  await page.getByLabel("Code PIN").fill("123456");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/agent$/);
}

test.describe("Agent app (M4)", () => {
  test("anonymous visitors land on the agent login; a wrong PIN shows the French error", async ({
    page,
  }) => {
    await page.goto("/agent");
    await expect(page).toHaveURL(/\/agent\/login/);
    await page.getByLabel("Matricule agent").fill("AG-KAM-007");
    await page.getByLabel("Code PIN").fill("999999");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByText("Matricule ou code PIN incorrect.")).toBeVisible();
  });

  test("login registers the device, shows the route, and the scanner search opens a profile", async ({
    page,
  }) => {
    await loginAgent(page);
    await expect(page.getByText("Kalenga Mbuyi")).toBeVisible();
    await expect(page.getByText("Ma tournée · Av. Kasaï")).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem("lub.agent.device"));
    expect(stored).toContain("DEV-");
    await page.getByRole("link", { name: "Scanner", exact: true }).click();
    await page.getByLabel("Nom, téléphone ou identifiant").fill("Mwamba");
    await page.getByRole("link", { name: /Mwamba Kasongo Jean/ }).click();
    await expect(page).toHaveURL(/\/agent\/contribuables\/LUB-KAM-00000125/);
    await expect(page.getByText("Solde à payer")).toBeVisible();
    // The seeded 10 000 FC grows with penalties once the server is past the due dates and shrinks
    // with demo payments: assert a balance in FC, not the seed-day figure.
    await expect(page.getByText(/\d{1,3}(\s\d{3})*\sFC/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Encaisser/ })).toBeVisible();
  });

  test("three-step census: duplicate warning, GPS, obligation preview, ID and QR", async ({
    page,
  }) => {
    await loginAgent(page);
    await page.getByRole("link", { name: "Recenser", exact: true }).click();
    await expect(page.getByText("Étape 1 sur 3")).toBeVisible();
    await page.getByLabel("Nom complet").fill("Mwamba Kasongo Jean");
    await page.getByLabel("Téléphone (pour le reçu SMS)").fill("+243994128830");
    await expect(page.getByText("Doublon possible :")).toBeVisible();
    const unique = `E2E Census ${Date.now()}`;
    await page.getByLabel("Nom complet").fill(unique);
    await page
      .getByLabel("Téléphone (pour le reçu SMS)")
      .fill(`+24399${String(Date.now()).slice(-7)}`);
    await page.getByLabel("Adresse").fill("Av. Kasaï 999");
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page.getByText("Étape 2 sur 3")).toBeVisible();
    await expect(page.getByText(/précision \d+ m/)).toBeVisible();
    await expect(page.getByText("5 000 FC")).toBeVisible();
    await page.getByRole("button", { name: "Enregistrer le contribuable" }).click();
    await expect(page.getByText("Contribuable enregistré")).toBeVisible();
    await expect(page.getByText(/LUB-KAM-\d{8}/)).toBeVisible();
    await expect(page.getByRole("img", { name: /LUB-KAM-\d{8}/ })).toBeVisible();
  });
});

test.describe("Census without a device position", () => {
  test.use({ permissions: [] }); // location refused by the browser

  test("explicit message and retry, point placed on the map, record saved; empty communes greyed out", async ({
    page,
  }) => {
    await loginAgent(page);
    await page.getByRole("link", { name: "Recenser", exact: true }).click();
    await expect(page.getByText("Étape 1 sur 3")).toBeVisible();
    // Only Kampemba has quartiers in the demo data: the others cannot dead-end step 1.
    await expect(page.locator('#commune option[value="RUA"]')).toBeDisabled();
    await page.getByLabel("Nom complet").fill(`E2E Sans GPS ${Date.now()}`);
    await page
      .getByLabel("Téléphone (pour le reçu SMS)")
      .fill(`+24398${String(Date.now()).slice(-7)}`);
    await page.getByLabel("Adresse").fill("Av. Kasaï 998");
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page.getByText("Étape 2 sur 3")).toBeVisible();
    await expect(page.getByText(/^Localisation refusée/)).toBeVisible();
    await expect(
      page.getByText("La position du bien est obligatoire pour enregistrer."),
    ).toBeVisible();
    const save = page.getByRole("button", { name: "Enregistrer le contribuable" });
    await expect(save).toBeDisabled();
    await expect(page.getByRole("button", { name: "Réessayer la localisation" })).toBeVisible();
    await page.getByRole("button", { name: "Placer le point sur la carte" }).click();
    const map = page.getByTestId("position-picker").locator(".leaflet-container");
    await expect(map).toBeVisible();
    await expect(page.getByRole("button", { name: "Utiliser ce point" })).toBeDisabled();
    await map.click({ position: { x: 200, y: 130 } });
    await page.getByRole("button", { name: "Utiliser ce point" }).click();
    await expect(page.getByText(/placé à la main/)).toBeVisible();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText("Contribuable enregistré")).toBeVisible();
    await expect(page.getByText(/LUB-KAM-\d{8}/)).toBeVisible();
  });
});
