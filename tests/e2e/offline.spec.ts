import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

loadEnvConfig(process.cwd(), true);

/**
 * M8 acceptance: 30 census records captured with no network (Playwright's offline mode), then the
 * network returns and exactly 30 households exist on the server. Runs against the dev server,
 * so the service worker is not involved: the outbox lives in the app's own JavaScript.
 */
test.use({
  viewport: { width: 390, height: 780 },
  geolocation: { latitude: -11.6642, longitude: 27.493 },
  permissions: ["geolocation"],
});
test.setTimeout(300_000);

const TOTAL = 30;

test("30 households registered offline reach the server once the network is back", async ({
  page,
  context,
}) => {
  const stamp = String(Date.now()).slice(-8);
  await page.goto("/agent/login");
  await page.getByLabel("Matricule agent").fill("AG-KAM-007");
  await page.getByLabel("Code PIN").fill("123456");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/agent$/);
  await page.goto("/agent/recenser");
  await expect(page.getByLabel("Nom complet")).toBeVisible();

  // Airplane mode.
  await context.setOffline(true);
  await expect(page.getByRole("status")).toContainText("Hors ligne");

  for (let i = 1; i <= TOTAL; i++) {
    await page
      .getByLabel("Nom complet")
      .fill(`E2E Hors ligne ${stamp} ${String(i).padStart(2, "0")}`);
    await page
      .getByLabel("Téléphone (pour le reçu SMS)")
      .fill(`+24396${stamp.slice(0, 5)}${String(i).padStart(2, "0")}`);
    await page.getByLabel("Adresse").fill(`Av. Hors-ligne ${i}`);
    await expect(page.getByText("Hors ligne : doublons non vérifiés")).toBeVisible();
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page.getByText(/précision \d+ m/)).toBeVisible();
    await expect(page.getByText("Aperçu des obligations indisponible hors ligne")).toBeVisible();
    await page.getByRole("button", { name: "Enregistrer le contribuable" }).click();
    await expect(page.getByText("Enregistré hors ligne")).toBeVisible();
    await expect(page.getByText(`${i} enregistrement(s) en attente d’envoi`)).toBeVisible();
    await expect(page.getByRole("link", { name: "Encaisser maintenant" })).toHaveCount(0); // invariant 3
    await page.getByRole("button", { name: "Recenser un autre contribuable" }).click();
  }

  // Network back: the sync manager drains the queue on the `online` event (and again on every
  // page it is mounted on, so a reload by the dev server's HMR reconnect changes nothing).
  await context.setOffline(false);
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.goto("/agent/sync");
  // "30 en attente" contains "0 en attente": anchor on the separator.
  await expect(page.getByText(/· 0 en attente/)).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("Synchronisé").first()).toBeVisible();
  await expect(page.getByText(/LUB-KAM-\d{8}/).first()).toBeVisible();

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const r = await client.query<{ n: string }>(
      "select count(*)::text as n from app.taxpayers where full_name like $1",
      [`E2E Hors ligne ${stamp} %`],
    );
    expect(Number(r.rows[0]!.n)).toBe(TOTAL);
  } finally {
    await client.end();
  }

  // Syncing again creates nothing new (client UUIDs are idempotent; done items are not replayed).
  await page.getByRole("button", { name: "Synchroniser maintenant" }).click();
  await expect(page.getByText(/· 0 en attente/)).toBeVisible();
  const again = new Client({ connectionString: process.env.DATABASE_URL });
  await again.connect();
  try {
    const r = await again.query<{ n: string }>(
      "select count(*)::text as n from app.taxpayers where full_name like $1",
      [`E2E Hors ligne ${stamp} %`],
    );
    expect(Number(r.rows[0]!.n)).toBe(TOTAL);
  } finally {
    await again.end();
  }
});
