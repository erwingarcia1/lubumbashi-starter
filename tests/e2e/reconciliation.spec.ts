import { expect, test, type Page } from "@playwright/test";

/**
 * M9 demo as a test: Finances runs today's reconciliation (the mock statement drops the latest
 * confirmation, doubles the previous one and adds an unknown line per channel), clears every
 * exception with the prototype's three actions, and closes the day. Re-runnable: resolved
 * exceptions stay resolved and an already closed day is shown as such.
 */
async function login(page: Page, email: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill("Lubumbashi2026!");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/admin(\?|$)/);
}

test("Finances reconciles the day, resolves the three exception types, closes the day", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await login(page, "ngoy.k@lubumbashi.cd");
  await page.locator('nav a[href="/admin/rapprochement"]').click();
  await expect(page.getByRole("heading", { name: /Rapprochement quotidien/ })).toBeVisible();

  await page.getByRole("button", { name: "Lancer le rapprochement" }).click();
  await expect(page.getByText("Rapprochement terminé.")).toBeVisible();

  // Resolve until nothing is open, one row at a time (each action re-renders the page).
  const openRow = (type: RegExp) =>
    page
      .getByRole("row", { name: type })
      .filter({ has: page.getByRole("button") })
      .first();
  const settle = async () => {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
  };
  for (let i = 0; i < 24; i++) {
    await settle();
    const missing = openRow(/Absent du relevé/);
    const duplicate = openRow(/Doublon fournisseur/);
    const unknown = openRow(/Hors plateforme/);
    if (await missing.isVisible().catch(() => false)) {
      await missing.getByRole("button", { name: /^Re-interroger/ }).click();
      await expect(
        page.getByText(/Le fournisseur confirme le paiement|ne confirme toujours pas/),
      ).toBeVisible();
      if (
        await page
          .getByText("ne confirme toujours pas")
          .isVisible()
          .catch(() => false)
      ) {
        // The mock refuses amounts ending in 999: Finances records the outcome by hand.
        const row = openRow(/Absent du relevé/);
        await row.getByRole("button", { name: "Clôturer l’écart" }).click();
        await row.getByLabel("Résolution").fill("Montant de test refusé par le simulateur");
        await row.getByRole("button", { name: "Clôturer l’écart" }).click();
        await expect(page.getByText("Écart clôturé.")).toBeVisible();
      }
      continue;
    }
    if (await duplicate.isVisible().catch(() => false)) {
      await duplicate.getByRole("button", { name: "Demander l’annulation" }).click();
      await duplicate.getByLabel("Motif").fill("Débit en double signalé par le contribuable");
      await duplicate.getByRole("button", { name: "Demander l’annulation" }).click();
      await expect(
        page.getByText("Annulation demandée au fournisseur : écart résolu."),
      ).toBeVisible();
      continue;
    }
    if (await unknown.isVisible().catch(() => false)) {
      await unknown.getByRole("button", { name: "Rattacher à un contribuable" }).click();
      await unknown.getByLabel("Identifiant du contribuable").fill("LUB-KAM-00000127");
      await unknown.getByRole("button", { name: "Rattacher à un contribuable" }).click();
      await expect(page.getByText("Ligne rattachée : paiement et reçu créés.")).toBeVisible();
      continue;
    }
    break;
  }
  await expect(page.getByRole("button", { name: /^Re-interroger/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Demander l’annulation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rattacher à un contribuable" })).toHaveCount(0);

  const closeButton = page.getByRole("button", { name: "Clôturer la journée" });
  if (await closeButton.isVisible().catch(() => false)) {
    await page.getByLabel("Note (facultative)").fill("Clôture de démonstration");
    await closeButton.click();
    await expect(page.getByText("Journée clôturée.")).toBeVisible();
  }
  await expect(page.getByText(/Journée clôturée/).first()).toBeVisible();
  await expect(page.getByText("Historique des clôtures")).toBeVisible();

  // The auditor sees everything but cannot act.
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await login(page, "auditeur@lubumbashi.cd");
  await page.goto("/admin/rapprochement");
  await expect(page.getByText(/Lecture seule/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Lancer le rapprochement" })).toHaveCount(0);
});
