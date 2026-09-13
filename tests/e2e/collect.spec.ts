import { expect, test } from "@playwright/test";

/**
 * Needs the seeded stack and the mock provider (PAYMENT_PROVIDERS=mock, APP_ENV≠production).
 * Registers its own household first so the seeded demo data (taxpayer 125) stays untouched:
 * confirmations are append-only, a paid balance cannot be undone.
 */
test.use({
  viewport: { width: 390, height: 780 },
  geolocation: { latitude: -11.6648, longitude: 27.4952 },
  permissions: ["geolocation"],
});

test("agent registers a household, collects its balance with the mock provider, and the receipt verifies publicly", async ({
  page,
  context,
}) => {
  await page.goto("/agent/login");
  await page.getByLabel("Matricule agent").fill("AG-KAM-007");
  await page.getByLabel("Code PIN").fill("123456");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/agent$/);

  // Census (steps 1–3) of a fresh household.
  await page.goto("/agent/recenser");
  await page.getByLabel("Nom complet").fill(`E2E Encaissement ${Date.now()}`);
  await page
    .getByLabel("Téléphone (pour le reçu SMS)")
    .fill(`+24398${String(Date.now()).slice(-7)}`);
  await page.getByLabel("Adresse").fill("Av. Kasaï 1000");
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByText(/précision \d+ m/)).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer le contribuable" }).click();
  await expect(page.getByText("Contribuable enregistré")).toBeVisible();
  const idText = await page
    .getByText(/LUB-KAM-\d{8}/)
    .first()
    .textContent();
  const taxpayerNo = /LUB-KAM-\d{8}/.exec(idText ?? "")![0];

  // Collect: one open obligation (current month), 5 000 FC.
  await page.getByRole("link", { name: "Encaisser maintenant" }).click();
  await expect(page.getByText("Canal de paiement")).toBeVisible();
  await expect(page.getByText("5 000 FC").first()).toBeVisible();
  await page.getByRole("button", { name: /M-Pesa/ }).click();
  await page.getByRole("button", { name: "Envoyer la demande de paiement" }).click();
  await expect(page.getByText("Demande envoyée")).toBeVisible();
  await expect(page.getByText(/TX-\d{4}-\d{2}-\d{4}-[A-Z2-9]{4}/)).toBeVisible();
  await expect(page.getByText("Paiement reçu")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/RCP-\d{4}-\d{6}/).first()).toBeVisible();
  const verifyLine = await page.getByText(/Vérifiez ce reçu/).textContent();
  const path = /\/v\/RCP-\d{4}-\d{6}\/[0-9a-f]{32}/.exec(verifyLine ?? "")?.[0];
  expect(path).toBeTruthy();

  // Public verification, no login; a wrong token is refused.
  const anon = await context.browser()!.newContext();
  const pub = await anon.newPage();
  await pub.goto(path!);
  await expect(pub.getByText("Reçu authentique")).toBeVisible();
  await expect(pub.getByText(`••${taxpayerNo.slice(-3)}`)).toBeVisible();
  await pub.goto(path!.replace(/[0-9a-f]{32}$/, "0".repeat(32)));
  await expect(pub.getByText("Reçu inconnu")).toBeVisible();
  await anon.close();

  // Nothing left to collect.
  await page.goto(`/agent/contribuables/${taxpayerNo}`);
  await expect(page.getByText("Rien à encaisser")).toBeVisible();
});
