import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Lubumbashi2026!";

/** Every admin screen, as the Administrateur (allowed everywhere). */
const ROUTES = [
  "/admin",
  "/admin/recettes",
  "/admin/recettes?groupe=month",
  "/admin/carte",
  "/admin/contribuables",
  "/admin/contribuables/LUB-KAM-00000125",
  "/admin/contribuables/nouveau",
  "/admin/agents",
  "/admin/agents/AG-KAM-007",
  "/admin/rapprochement",
  "/admin/taxes",
  "/admin/taxes/assainissement_menage",
  "/admin/audit",
  "/admin/rapports",
  "/admin/reglages",
  "/admin/commissions",
  "/admin/commissions?mois=2026-09",
];

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  laptop: { width: 1280, height: 800 },
  desktop: { width: 1920, height: 1080 },
} as const;

async function loginAdmin(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Adresse e-mail").fill("admin@lubumbashi.cd");
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/admin(\?|$)/);
}

/** The page must never scroll sideways; wide tables scroll inside their own container. */
async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(doc.scrollWidth, document.body.scrollWidth) - doc.clientWidth;
  });
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`${name} ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test("every admin screen fits the width and the navigation works", async ({ page }) => {
      test.setTimeout(process.env.PLAYWRIGHT_BASE_URL ? 600_000 : 240_000); // 13 routes, dev compile
      await loginAdmin(page);
      const failures: string[] = [];
      for (const route of ROUTES) {
        await page.goto(route);
        await expect(page.locator("main h1, main h2").first()).toBeVisible();
        const px = await overflow(page);
        if (px > 1) failures.push(`${route}: ${px}px too wide`);
      }
      expect(failures).toEqual([]);

      await page.goto("/admin");
      const menu = page.getByRole("button", { name: "Ouvrir le menu" });
      const carte = page.getByRole("link", { name: "Carte" });
      if (viewport.width < 768) {
        await expect(menu).toBeVisible();
        await expect(carte).toBeHidden();
        await menu.click();
        await expect(carte).toBeVisible();
        await carte.click();
        await expect(page).toHaveURL(/\/admin\/carte$/);
        await expect(page.getByRole("heading", { name: /^Carte · / })).toBeVisible();
        await expect(carte).toBeHidden(); // the drawer closed on navigation
        // The drawer must sit above the Leaflet map (its panes carry z-index 400-1000).
        await menu.click();
        await page.getByRole("link", { name: "Vue d’ensemble" }).click();
        await expect(page).toHaveURL(/\/admin$/);
        await menu.click();
        await page.keyboard.press("Escape");
        await expect(carte).toBeHidden();
      } else {
        await expect(menu).toBeHidden();
        await expect(carte).toBeVisible();
      }
    });

    test("agent and portal screens stay usable", async ({ page }) => {
      await page.goto("/agent/login");
      await expect(page.getByLabel("Matricule agent")).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.goto("/");
      await expect(page.locator("h1").first()).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(1);
    });
  });
}
