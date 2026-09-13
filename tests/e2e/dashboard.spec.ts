import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Lubumbashi2026!";

async function loginAdmin(page: Page, email: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/admin(\?|$)/);
}

test("the mayor's walkthrough: overview → alert → agents → revoke a device → map", async ({
  page,
  browser,
}) => {
  // An agent logs in on a fresh "phone" so there is a device to revoke.
  const phone = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const agent = await phone.newPage();
  await agent.goto("/agent/login");
  await agent.getByLabel("Matricule agent").fill("AG-KAM-019");
  await agent.getByLabel("Code PIN").fill("123456");
  await agent.getByRole("button", { name: "Se connecter" }).click();
  await expect(agent).toHaveURL(/\/agent$/);
  const stored = JSON.parse(
    (await agent.evaluate(() => localStorage.getItem("lub.agent.device"))) ?? "{}",
  ) as { code: string };
  expect(stored.code).toMatch(/^DEV-/);

  await loginAdmin(page, "maire@lubumbashi.cd");
  await expect(page.getByRole("heading", { name: "Vue d’ensemble" })).toBeVisible();
  await expect(page.getByText("Contribuables recensés")).toBeVisible();
  await expect(page.getByText("Taux de recouvrement")).toBeVisible();
  await expect(page.getByTestId("daily-chart")).toBeVisible();
  await page.getByRole("link", { name: /Agent\(s\) avec taux d’échec anormal/ }).click();
  await expect(page.getByRole("heading", { name: "Agents de terrain" })).toBeVisible();
  await expect(page.getByText("AG-KAM-007").first()).toBeVisible();
  // The Maire cannot revoke: no button.
  await expect(page.getByRole("button", { name: "Révoquer" })).toHaveCount(0);
  await page.getByRole("button", { name: "Se déconnecter" }).click();

  await loginAdmin(page, "admin@lubumbashi.cd");
  await page.goto("/admin/agents");
  const row = page
    .locator("div", { hasText: stored.code })
    .filter({ has: page.getByRole("button", { name: "Révoquer" }) })
    .last();
  await row.getByPlaceholder("Motif de révocation").fill("Perte déclarée");
  await row.getByRole("button", { name: "Révoquer" }).click();
  await expect(page.getByText("Appareil révoqué")).toBeVisible();

  // The agent is logged out on the next request; the login with the revoked device is refused.
  await agent.goto("/agent");
  await expect(agent).toHaveURL(/\/agent\/login/);
  await agent.getByLabel("Matricule agent").fill("AG-KAM-019");
  await agent.getByLabel("Code PIN").fill("123456");
  await agent.getByRole("button", { name: "Se connecter" }).click();
  await expect(
    agent.getByText("Cet appareil a été révoqué. Contactez votre superviseur."),
  ).toBeVisible();
  await phone.close();

  await page.getByRole("link", { name: "Carte" }).click();
  await expect(page.getByTestId("coverage-map")).toBeVisible();
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.locator("path.leaflet-interactive").first()).toBeVisible();
  // Changing the commune applies immediately (no "Rechercher" click); Ruashi has no census point yet,
  // so the map moves there and says so instead of staying on Kampemba.
  await page.getByLabel("Commune").selectOption("RUA");
  await expect(page).toHaveURL(/commune=RUA/);
  await expect(page.getByRole("heading", { name: "Carte · Ruashi" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Aucun contribuable recensé pour ces filtres.");
  await expect(page.locator("path.leaflet-interactive")).toHaveCount(0);
  await page.getByLabel("Commune").selectOption("");
  await expect(page.getByRole("heading", { name: "Carte · Toutes les communes" })).toBeVisible();
  await expect(page.locator("path.leaflet-interactive").first()).toBeVisible();
  await page.getByRole("link", { name: "Recettes" }).click();
  await expect(page.getByRole("heading", { name: "Recettes" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/RCP-\d{4}-\d{6}/).first()).toBeVisible({ timeout: 15_000 });
});
