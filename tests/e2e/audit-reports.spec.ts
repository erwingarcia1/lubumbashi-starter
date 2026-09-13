import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill("Lubumbashi2026!");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/admin(\?|$)/);
}

test("the auditor reads the journal, filters it, and exports it; Finances downloads the reports", async ({
  page,
}) => {
  await login(page, "auditeur@lubumbashi.cd");
  await page.locator('nav a[href="/admin/audit"]').click();
  await expect(page.getByRole("heading", { name: "Journal d’audit" })).toBeVisible();
  await expect(page.getByText("Contribuable recensé").first()).toBeVisible();
  await page.getByLabel("Action").fill("payment.");
  await page.getByRole("button", { name: "Filtrer" }).click();
  await expect(page).toHaveURL(/action=payment\./);
  await expect(
    page.getByText(/Paiement confirmé|Demande de paiement envoyée/).first(),
  ).toBeVisible();
  await expect(page.getByText("Contribuable recensé")).toHaveCount(0);
  await expect(page.getByText(/Le journal est en ajout seul/)).toBeVisible();

  const csv = await page.request.get("/api/v1/admin/reports/audit?format=csv&action=payment.");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const text = await csv.text();
  expect(text.split("\n")[0]).toContain("horodatage,acteur_type");
  expect(text).toContain("payment.");

  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await login(page, "ngoy.k@lubumbashi.cd");
  await page.locator('nav a[href="/admin/rapports"]').click();
  await expect(page.getByRole("heading", { name: "Rapports & exports" })).toBeVisible();
  await expect(page.getByText("Rapport mensuel de recouvrement")).toBeVisible();
  for (const [url, type, magic] of [
    ["/api/v1/admin/reports/monthly?format=xlsx&month=2026-09", "spreadsheetml", "PK"],
    ["/api/v1/admin/reports/monthly?format=pdf&month=2026-09", "application/pdf", "%PDF"],
    ["/api/v1/admin/reports/unpaid?format=xlsx", "spreadsheetml", "PK"],
    ["/api/v1/admin/reports/agents?format=pdf", "application/pdf", "%PDF"],
    ["/api/v1/admin/reports/reconciliation?format=pdf&day=2026-09-13", "application/pdf", "%PDF"],
    ["/api/v1/admin/reports/receipts?format=xlsx&month=2026-09", "spreadsheetml", "PK"],
  ] as const) {
    const res = await page.request.get(url);
    expect(res.status(), url).toBe(200);
    expect(res.headers()["content-type"], url).toContain(type);
    expect((await res.body()).subarray(0, magic.length).toString(), url).toBe(magic);
  }
  // Finances may not export the audit journal; the export itself was audited.
  expect((await page.request.get("/api/v1/admin/reports/audit?format=csv")).status()).toBe(403);
  await page.goto("/admin/audit?action=report.exported");
  await expect(page.getByText("Rapport exporté").first()).toBeVisible();
});
