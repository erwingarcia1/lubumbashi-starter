import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

loadEnvConfig(process.cwd(), true);

/**
 * Needs the seeded local stack (`pnpm db:seed`): taxpayer LUB-KAM-00000125 owes September 2026.
 * The note's first issue is reset in the database so the flow starts from an unissued note.
 */
async function login(page: Page, email: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(process.env.SEED_ADMIN_PASSWORD ?? "Lubumbashi2026!");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/admin(\?|$)/);
}

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

test("Finances issues the note de perception of the September obligation from the taxpayer page; the Auditeur cannot", async ({
  page,
}) => {
  const invoiceNo = await withDb(async (c) => {
    const r = await c.query<{ invoice_no: string }>(
      `select o.invoice_no from app.obligations o
         join app.taxpayers t on t.id = o.taxpayer_id
        where t.taxpayer_no = $1 and o.period_start = '2026-09-01'`,
      ["LUB-KAM-00000125"],
    );
    const no = r.rows[0]!.invoice_no;
    await c.query(
      "update app.obligations set invoice_issued_at = null, invoice_issued_by_admin_id = null where invoice_no = $1",
      [no],
    );
    return no;
  });
  const href = `/api/v1/admin/invoices/${invoiceNo}/pdf`;

  await login(page, "ngoy.k@lubumbashi.cd");
  await page.goto("/admin/contribuables/LUB-KAM-00000125");
  await expect(page.getByRole("heading", { name: "Mwamba Kasongo Jean" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Note de perception" })).toBeVisible();
  const row = page.getByRole("row", { name: /sept\. 2026/ }).first();
  const link = row.getByRole("link", { name: "Note de perception" });
  await expect(link).toHaveAttribute("href", href);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(row).not.toContainText("émise le");

  // The click opens the PDF in a new tab (headless Chromium turns it into a download): the
  // navigation response is the note itself.
  const responsePromise = page
    .context()
    .waitForEvent("response", (r) => r.url().endsWith(href) && r.request().isNavigationRequest());
  await link.click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  const direct = await page.request.get(href);
  expect(direct.status()).toBe(200);
  expect(direct.headers()["content-type"]).toContain("application/pdf");
  expect(direct.headers()["content-disposition"]).toContain(`inline; filename="${invoiceNo}.pdf"`);
  expect((await direct.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // The first issue is stamped and shown under the link; the journal has the action.
  await page.reload();
  const issuedRow = page.getByRole("row", { name: /sept\. 2026/ }).first();
  await expect(issuedRow).toContainText(/émise le \d{2}\/\d{2}\/\d{4}/);
  await expect(issuedRow.getByRole("link", { name: "Note de perception" })).toBeVisible();
  await page.goto(`/admin/audit?action=invoice.issued&object=${invoiceNo}`);
  await expect(page.getByText(invoiceNo).first()).toBeVisible();
  await expect(page.getByText("ngoy.k@lubumbashi.cd").first()).toBeVisible();
  await page.getByRole("button", { name: "Se déconnecter" }).click();

  // The Auditeur reads the issue date but has no link, and the API refuses before reading anything.
  await login(page, "auditeur@lubumbashi.cd");
  await page.goto("/admin/contribuables/LUB-KAM-00000125");
  await expect(page.getByRole("heading", { name: "Mwamba Kasongo Jean" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Note de perception" })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /sept\. 2026/ }).first()).toContainText("émise le");
  expect((await page.request.get(href)).status()).toBe(403);
  expect((await page.request.get("/api/v1/admin/invoices/AV-0000-000000/pdf")).status()).toBe(403);
});
