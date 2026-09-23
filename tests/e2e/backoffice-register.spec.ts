import { expect, test, type Page } from "@playwright/test";

/** Needs the seeded local stack (Mairie accounts, Kampemba quartiers). */
async function login(page: Page, email: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(process.env.SEED_ADMIN_PASSWORD ?? "Lubumbashi2026!");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/admin(\?|$)/);
}

test("the Superviseur registers a taxpayer from the dashboard and prints its note de perception; the Auditeur cannot", async ({
  page,
}) => {
  await login(page, "ilunga.m@lubumbashi.cd");
  await page.locator('nav a[href="/admin/contribuables"]').click();
  await page.getByRole("link", { name: "Nouveau contribuable" }).click();
  await expect(page).toHaveURL(/\/admin\/contribuables\/nouveau$/);
  await expect(page.getByRole("heading", { name: "Nouveau contribuable" })).toBeVisible();

  // Only Kampemba has quartiers in the demo data: the others are greyed out.
  await expect(page.locator('#communeCode option[value="RUA"]')).toBeDisabled();
  const name = `E2E Guichet ${Date.now()}`;
  await page.getByLabel("Nom complet").fill(name);
  await page
    .getByLabel("Téléphone (pour le reçu SMS)")
    .fill(`+24397${String(Date.now()).slice(-7)}`);
  await page.getByLabel("Adresse").fill("Av. du Guichet 12");
  await page.getByLabel("Quartier").selectOption({ label: "Bel-Air" });
  await page.getByLabel("Catégorie fiscale").selectOption({ label: "Ménage" });

  // No position yet: the record cannot be saved; the map is placed by hand.
  const save = page.getByRole("button", { name: "Enregistrer le contribuable" });
  await expect(save).toBeDisabled();
  const map = page.getByTestId("position-picker").locator(".leaflet-container");
  await expect(map).toBeVisible();
  await expect(page.getByRole("button", { name: "Utiliser ce point" })).toBeDisabled();
  await map.click({ position: { x: 200, y: 130 } });
  await page.getByRole("button", { name: "Utiliser ce point" }).click();
  await expect(page.getByText("Point placé :")).toBeVisible();
  await expect(save).toBeEnabled();
  await save.click();

  // The taxpayer page opens with the new identifier and its first note ready to print.
  await expect(page).toHaveURL(/\/admin\/contribuables\/LUB-KAM-\d{8}\?ok=created$/);
  const taxpayerNo = /LUB-KAM-\d{8}/.exec(page.url())![0];
  await expect(page.getByText(`Contribuable enregistré : ${taxpayerNo}`)).toBeVisible();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  const row = page.getByRole("row", { name: /À venir/ }).first();
  const link = row.getByRole("link", { name: "Note de perception" });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/api\/v1\/admin\/invoices\/AV-\d{4}-\d{6}\/pdf$/);
  const pdf = await page.request.get(href!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // The journal has the registration by the Mairie user.
  await page.goto(`/admin/audit?action=taxpayer.registered&object=${taxpayerNo}`);
  await expect(page.getByText(taxpayerNo).first()).toBeVisible();
  await expect(page.getByText("ilunga.m@lubumbashi.cd").first()).toBeVisible();
  await page.getByRole("button", { name: "Se déconnecter" }).click();

  // The Auditeur has no button and the page sends him to « Accès refusé ».
  await login(page, "auditeur@lubumbashi.cd");
  await page.goto("/admin/contribuables");
  await expect(page.getByRole("heading", { name: "Contribuables" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nouveau contribuable" })).toHaveCount(0);
  await page.goto("/admin/contribuables/nouveau");
  await expect(page).toHaveURL(/\/admin\/interdit$/);
  await expect(page.getByRole("heading", { name: "Accès refusé" })).toBeVisible();
});

test("a phone number already on file is refused with the existing identifier and the fields kept", async ({
  page,
}) => {
  await login(page, "admin@lubumbashi.cd");
  await page.goto("/admin/contribuables/nouveau");
  const name = `E2E Doublon ${Date.now()}`;
  await page.getByLabel("Nom complet").fill(name);
  await page.getByLabel("Téléphone (pour le reçu SMS)").fill("+243994128830");
  await page.getByLabel("Adresse").fill("Av. Kasaï 12");
  const map = page.getByTestId("position-picker").locator(".leaflet-container");
  await map.click({ position: { x: 180, y: 120 } });
  await page.getByRole("button", { name: "Utiliser ce point" }).click();
  await page.getByRole("button", { name: "Enregistrer le contribuable" }).click();
  // Scoped to the form: Next's route announcer is a `role="alert"` too.
  const alert = page.locator('form [role="alert"]');
  await expect(alert).toContainText(
    "Un contribuable est déjà enregistré avec ce numéro de téléphone : LUB-KAM-00000125",
  );
  await expect(alert.getByRole("link", { name: "Ouvrir sa fiche" })).toHaveAttribute(
    "href",
    "/admin/contribuables/LUB-KAM-00000125",
  );
  await expect(page).toHaveURL(/\/admin\/contribuables\/nouveau$/);
  await expect(page.getByLabel("Nom complet")).toHaveValue(name);
  await expect(page.getByLabel("Adresse")).toHaveValue("Av. Kasaï 12");
  await expect(page.getByText("Point placé :")).toBeVisible();
});
