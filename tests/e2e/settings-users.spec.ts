import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string, password = "Lubumbashi2026!") {
  await page.goto("/admin/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

test("the Administrateur creates a Mairie user who logs in with the one-time password; Recettes groups by month", async ({
  page,
  browser,
}) => {
  await login(page, "admin@lubumbashi.cd");
  await expect(page).toHaveURL(/\/admin(\?|$)/);
  await page.locator('nav a[href="/admin/reglages"]').click();
  await expect(page.getByRole("heading", { name: /Réglages/ })).toBeVisible();
  const email = `recette.${Date.now()}@lubumbashi.cd`;
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Nom complet").fill("Utilisateur Recette");
  await page.getByLabel("Rôle").first().selectOption("auditeur");
  await page.getByRole("button", { name: "Créer l’accès" }).click();
  await expect(page.getByText("Accès créé pour")).toBeVisible({ timeout: 20_000 });
  const password = (await page.locator("code").first().textContent())?.trim();
  expect(password).toMatch(/^[A-Za-z2-9]{14}!$/);
  await expect(page.getByRole("cell", { name: email })).toBeVisible();

  const other = await browser.newContext();
  const p2 = await other.newPage();
  await login(p2, email, password!);
  await expect(p2).toHaveURL(/\/admin(\?|$)/);
  await expect(p2.getByText("Rôle : Auditeur")).toBeVisible();
  await other.close();

  await page.locator('nav a[href="/admin/recettes"]').click();
  await page.getByLabel("Regrouper par").selectOption("month");
  await page.getByRole("button", { name: "Appliquer" }).click();
  await expect(page.getByText(/Encaissé par période · Mois/)).toBeVisible();
});
