import { expect, test, type Page } from "@playwright/test";

/**
 * Agent commissions (D36): the agent reads what the month earned; Finances recomputes the
 * drafts, approves AG-KAM-007's statement and marks it paid; the Auditeur only reads.
 * Re-runnable: once a statement is paid it stays paid, and the test then checks that state.
 */
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Lubumbashi2026!";
const MONTH = /FC/;

async function loginAdmin(page: Page, email: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/admin(\?|$)/);
}

test.describe("agent app", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("AG-KAM-007 opens Mes commissions and sees the month total; the API returns the same view", async ({
    page,
  }) => {
    await page.goto("/agent/login");
    await page.getByLabel("Matricule agent").fill("AG-KAM-007");
    await page.getByLabel("Code PIN").fill("123456");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page).toHaveURL(/\/agent$/);
    await page.getByRole("link", { name: /Mes commissions/ }).click();
    await expect(page).toHaveURL(/\/agent\/commissions$/);
    await expect(page.getByText("Mes commissions").first()).toBeVisible();
    await expect(page.getByText("Total du mois")).toBeVisible();
    await expect(page.getByText("Commission sur encaissements")).toBeVisible();
    await expect(page.getByText("Prime de recensement")).toBeVisible();
    await expect(page.getByText(/Barème : 5 % des encaissements confirmés/)).toBeVisible();
    await expect(page.getByText("Détail par jour")).toBeVisible();
    const total = await page.locator("dd").last().textContent();
    expect(total).toMatch(MONTH);

    const res = await page.request.get("/api/v1/agent/commissions?month=2026-09");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { period: string; totals: { totalFc: number; collectionsCount: number } };
    };
    expect(body.ok).toBe(true);
    expect(body.data.period).toBe("2026-09");
    expect(body.data.totals.collectionsCount).toBeGreaterThan(0);
    expect(Number.isInteger(body.data.totals.totalFc)).toBe(true);
    expect((await page.request.get("/api/v1/agent/commissions?month=2026-13")).status()).toBe(422);
  });
});

test("Finances recomputes the drafts, approves AG-KAM-007's statement and marks it paid; the Auditeur only reads", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await loginAdmin(page, "ngoy.k@lubumbashi.cd");
  await page.goto("/admin/commissions?mois=2026-09");
  await expect(page.getByRole("heading", { name: /Commissions des agents/ })).toBeVisible();
  await expect(page.getByText("Barème des commissions")).toBeVisible();

  const submitAndWait = async (click: () => Promise<void>) => {
    const before = page.url();
    await click();
    await page.waitForURL((u) => u.toString() !== before, { timeout: 60_000 });
    await page.waitForLoadState("networkidle");
  };
  await submitAndWait(() =>
    page.getByRole("button", { name: "Recalculer les brouillons" }).click(),
  );
  await expect(page.getByText("Brouillons recalculés pour le mois.")).toBeVisible();

  const row = () => page.locator("tbody tr").filter({ hasText: "AG-KAM-007" }).first();
  await expect(row()).toContainText("Kalenga Mbuyi");
  await expect(row()).toContainText(/FC/);
  if (await row().getByRole("button", { name: "Approuver" }).isVisible()) {
    await submitAndWait(() => row().getByRole("button", { name: "Approuver" }).click());
    await expect(page.getByText("Relevé approuvé : ses lignes sont figées.")).toBeVisible();
    await expect(row()).toContainText("Approuvé");
  }
  if (await row().getByRole("button", { name: "Marquer payé" }).isVisible()) {
    await row()
      .getByLabel(/Référence du virement AG-KAM-007/)
      .fill("VIR-TEST-1");
    await submitAndWait(() => row().getByRole("button", { name: "Marquer payé" }).click());
    await expect(page.getByText("Relevé marqué payé.")).toBeVisible();
  }
  await expect(row()).toContainText("Payé");
  await expect(row()).toContainText("VIR-TEST-1");
  await expect(row().getByRole("button")).toHaveCount(0);

  // The Excel export of the month downloads.
  const xlsx = await page.request.get(
    "/api/v1/admin/reports/commissions?format=xlsx&month=2026-09",
  );
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
  expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");

  // Finances does not edit the scale.
  await expect(page.getByRole("button", { name: "Enregistrer la version" })).toHaveCount(0);
  await expect(page.getByText("Seul l’Administrateur modifie le barème.")).toBeVisible();

  await page.getByRole("button", { name: "Se déconnecter" }).click();
  // The sign-out action must finish before another login, or its response clears the new cookie.
  await expect(page).toHaveURL(/\/admin\/login/);
  await loginAdmin(page, "auditeur@lubumbashi.cd");
  await page.goto("/admin/commissions?mois=2026-09");
  await expect(page.getByRole("heading", { name: /Commissions des agents/ })).toBeVisible();
  await expect(page.getByText(/^Lecture seule/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Recalculer les brouillons" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approuver" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Marquer payé" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enregistrer la version" })).toHaveCount(0);
  await expect(page.locator("tbody tr").filter({ hasText: "AG-KAM-007" }).first()).toContainText(
    "Payé",
  );
});

/** ISO day `n` days after an ISO day. */
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** dd/MM/yyyy, as `formatDateFr` prints an ISO day. */
const frDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

test("the Administrateur adds a scale version: one version stays Active, the new one is À venir and ends the previous one", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await loginAdmin(page, "admin@lubumbashi.cd");
  await page.goto("/admin/commissions?mois=2026-09");
  const scale = page.getByRole("table", { name: "Barème des commissions" });
  await expect(scale).toBeVisible();
  const chain = scale.locator('tbody tr[data-code="collection_percent"]');
  const active = scale.locator('tbody tr[data-code="collection_percent"][data-state="active"]');
  expect(await chain.count()).toBeGreaterThan(0);
  // Whatever earlier runs left, exactly one version of each rule is Active today.
  await expect(active).toHaveCount(1);
  await expect(scale.locator('tbody tr[data-state="active"]')).toHaveCount(2);
  await expect(scale.getByText("Active", { exact: true })).toHaveCount(2);

  // A new version must start after the latest one (and after today); the demo's 5 % must stay
  // in force, so the test dates it at least ten years out. Re-runnable: dates only grow, and
  // the two-day step leaves a gap before the new version for the refusal check below.
  const froms = await chain.evaluateAll((rows) =>
    rows.map((r) => r.getAttribute("data-effective-from") ?? ""),
  );
  const latest = froms.sort().at(-1)!;
  const today = new Date().toISOString().slice(0, 10);
  const floor = plusDays(today, 3650);
  const day = plusDays(latest > floor ? latest : floor, 2);
  const previousRow = scale.locator(
    `tbody tr[data-code="collection_percent"][data-effective-from="${latest}"]`,
  );
  await expect(previousRow).toHaveCount(1);
  await expect(previousRow.locator("td").nth(4)).toHaveText("—");

  const form = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Enregistrer la version" }) });
  const submit = async (rate: string, from: string) => {
    await form.getByLabel("Base").selectOption("collection_percent");
    await form.getByLabel("Taux (%)").fill(rate);
    await form.getByLabel("En vigueur le").fill(from);
    const before = page.url();
    await form.getByRole("button", { name: "Enregistrer la version" }).click();
    await page.waitForURL((u) => u.toString() !== before, { timeout: 60_000 });
    await page.waitForLoadState("networkidle");
  };
  await submit("5.5", day);
  await expect(page.getByText("Nouvelle version du barème enregistrée.")).toBeVisible();

  const created = scale.locator(
    `tbody tr[data-code="collection_percent"][data-effective-from="${day}"]`,
  );
  await expect(created).toHaveCount(1);
  await expect(created).toHaveAttribute("data-state", "upcoming");
  await expect(created).toContainText("À venir");
  await expect(created).toContainText("5,5 %");
  await expect(created.locator("td").nth(4)).toHaveText("—");
  // The previous version now ends the day the new one starts, and reads as before until then.
  await expect(previousRow.locator("td").nth(4)).toHaveText(frDate(day));
  await expect(previousRow).not.toContainText("Remplacée");
  // Still one Active version per rule, and the seeded 5 % is the one in force.
  await expect(active).toHaveCount(1);
  await expect(active).toContainText("5 %");
  await expect(scale.locator('tbody tr[data-state="active"]')).toHaveCount(2);
  await expect(scale.getByText("Active", { exact: true })).toHaveCount(2);

  // A version dated on or before the latest one (a day nothing is dated yet) is refused and
  // nothing is written.
  await submit("6", plusDays(day, -1));
  await expect(page).toHaveURL(/error=invalid_input/);
  await expect(page.getByText("Vérifiez les champs saisis.")).toBeVisible();
  await expect(scale.locator(`tbody tr[data-effective-from="${plusDays(day, -1)}"]`)).toHaveCount(
    0,
  );
  await expect(active).toHaveCount(1);
});
