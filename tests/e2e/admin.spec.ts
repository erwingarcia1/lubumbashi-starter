import { expect, test, type Page } from "@playwright/test";

/**
 * Needs the seeded local stack: `supabase start`, `pnpm db:migrate`, `pnpm db:seed`
 * (creates the admin logins with SEED_ADMIN_PASSWORD).
 */
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Lubumbashi2026!";

async function login(page: Page, email: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/admin(\?|$)/);
}

test.describe("Mairie dashboard (M3)", () => {
  test("anonymous visitors are sent to the login page", async ({ page }) => {
    await page.goto("/admin/taxes");
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByRole("heading", { name: "Tableau de bord Mairie" })).toBeVisible();
  });

  test("a wrong password shows the French error", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Adresse e-mail").fill("ngoy.k@lubumbashi.cd");
    await page.getByLabel("Mot de passe").fill("mauvais");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByText("Adresse ou mot de passe incorrect.")).toBeVisible();
  });

  test("Finances proposes a rate change, cannot approve it, the Administrateur can", async ({
    page,
  }) => {
    await login(page, "ngoy.k@lubumbashi.cd");
    await expect(page.getByText("Rôle : Finances")).toBeVisible();
    await page.getByRole("link", { name: "Taxes & barèmes" }).click();
    await expect(page.getByRole("heading", { name: "Taxes et barèmes" })).toBeVisible();
    await page.getByRole("link", { name: "Taxe d’assainissement" }).first().click();
    await expect(
      page.getByRole("heading", { name: /Taxe d’assainissement · Ménage/ }),
    ).toBeVisible();
    // One draft per (rule, effective date): pick a date no previous run used.
    const effectiveFrom = `${2100 + Math.floor(Math.random() * 800)}-03-01`;
    await page.getByLabel("Montant (FC)").fill("5500");
    await page.getByLabel("Nouvelle version en vigueur le").fill(effectiveFrom);
    await page.getByRole("button", { name: "Enregistrer (nécessite l’approbation)" }).click();
    await expect(
      page.getByText("Version proposée. Elle s’appliquera après approbation."),
    ).toBeVisible();
    const draftRow = page.getByRole("row", { name: /Brouillon/ }).first();
    await expect(draftRow).toContainText("5 500");
    // the proposer sees no approve button on her own draft
    await expect(draftRow.getByRole("button", { name: "Approuver" })).toHaveCount(0);
    await page.getByRole("button", { name: "Se déconnecter" }).click();

    await login(page, "admin@lubumbashi.cd");
    await page.goto("/admin/taxes/assainissement_menage");
    const row = page.getByRole("row", { name: /Brouillon/ }).first();
    await row.getByRole("button", { name: "Approuver" }).click();
    await expect(page.getByText("Version approuvée.")).toBeVisible();
    await expect(page.getByRole("row", { name: /À venir/ }).first()).toContainText("5 500");
  });

  test("the registry opens taxpayer 125 with its balance, obligations and journal", async ({
    page,
  }) => {
    await login(page, "ngoy.k@lubumbashi.cd");
    await page.goto("/admin/contribuables?q=Mwamba");
    await page.getByRole("link", { name: "LUB-KAM-00000125" }).click();
    await expect(page.getByRole("heading", { name: "Mwamba Kasongo Jean" })).toBeVisible();
    await expect(page.getByText("Solde à payer")).toBeVisible();
    await expect(page.getByText("10 000 FC").first()).toBeVisible();
    await expect(page.getByText("taxpayer.registered").first()).toBeVisible();
    await expect(page.getByRole("cell", { name: /Retard/ }).first()).toBeVisible();
  });
});
