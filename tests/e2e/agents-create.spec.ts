import { expect, test, type Page } from "@playwright/test";

async function loginAdmin(page: Page, email: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill("Lubumbashi2026!");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/admin(\?|$)/);
}

test("the Superviseur creates an agent, who logs in with the PIN; a changed PIN replaces it", async ({
  page,
  browser,
}) => {
  await loginAdmin(page, "ilunga.m@lubumbashi.cd");
  await page.locator('nav a[href="/admin/agents"]').click();
  const name = `Agent Recette ${Date.now()}`;
  await page.getByLabel("Nom complet").fill(name);
  await page.getByLabel("Quartier d’affectation").selectOption({ label: "Kampemba · Bel-Air" });
  await page.getByLabel("Code PIN (6 chiffres)").fill("246810");
  await page.getByRole("button", { name: "Créer l’agent" }).click();
  const banner = await page.getByText(/Agent créé\./).textContent();
  const matricule = /AG-[A-Z]{3}-\d{3}/.exec(banner ?? "")?.[0];
  expect(matricule).toBeTruthy();
  await expect(page.getByText(name)).toBeVisible();

  // The new agent logs in on a phone with the PIN chosen by the Mairie.
  const phone = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const app = await phone.newPage();
  await app.goto("/agent/login");
  await app.getByLabel("Matricule agent").fill(matricule!);
  await app.getByLabel("Code PIN").fill("246810");
  await app.getByRole("button", { name: "Se connecter" }).click();
  await expect(app).toHaveURL(/\/agent$/);
  await expect(app.getByText(name)).toBeVisible();
  await phone.close();

  // PIN change from the dashboard: the old one is refused, the new one works.
  await page.getByLabel(`Nouveau PIN ${matricule}`).fill("135790");
  await page
    .getByRole("row", { name: new RegExp(matricule!) })
    .getByRole("button", { name: "Changer le PIN" })
    .click();
  await expect(page.getByText("PIN modifié : l’ancien code ne fonctionne plus.")).toBeVisible();
  const phone2 = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const app2 = await phone2.newPage();
  await app2.goto("/agent/login");
  await app2.getByLabel("Matricule agent").fill(matricule!);
  await app2.getByLabel("Code PIN").fill("246810");
  await app2.getByRole("button", { name: "Se connecter" }).click();
  await expect(app2.getByText("Matricule ou code PIN incorrect.")).toBeVisible();
  await app2.getByLabel("Code PIN").fill("135790");
  await app2.getByRole("button", { name: "Se connecter" }).click();
  await expect(app2).toHaveURL(/\/agent$/);
  await phone2.close();
});
