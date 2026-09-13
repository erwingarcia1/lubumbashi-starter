import { expect, test } from "@playwright/test";

const TITLE = "Plateforme de recouvrement — Ville de Lubumbashi";

test("home page shows the platform title in French", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page).toHaveTitle(TITLE);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE);
});
