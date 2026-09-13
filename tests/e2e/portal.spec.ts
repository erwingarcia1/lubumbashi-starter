import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "pg";

loadEnvConfig(process.cwd(), true);

/**
 * Needs the seeded stack and the mock provider. Registers its own household through the agent app
 * (seeded balances are never consumed), then plants a portal link for it the way the SMS would
 * deliver one: the test knows the token, the database only knows its hash.
 */
test.use({
  viewport: { width: 390, height: 780 },
  geolocation: { latitude: -11.6648, longitude: 27.4952 },
  permissions: ["geolocation"],
});

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

test("portal: SMS link → balance → pay with the mock → receipt QR → complaint; avis QR pays exactly one period", async ({
  page,
  context,
}) => {
  // 1. A fresh household, registered by the agent.
  await page.goto("/agent/login");
  await page.getByLabel("Matricule agent").fill("AG-KAM-007");
  await page.getByLabel("Code PIN").fill("123456");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/agent$/);
  await page.goto("/agent/recenser");
  await page.getByLabel("Nom complet").fill(`E2E Portail ${Date.now()}`);
  await page
    .getByLabel("Téléphone (pour le reçu SMS)")
    .fill(`+24397${String(Date.now()).slice(-7)}`);
  await page.getByLabel("Adresse").fill("Av. Kasaï 2000");
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByText(/précision \d+ m/)).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer le contribuable" }).click();
  await expect(page.getByText("Contribuable enregistré")).toBeVisible();
  const idText = await page
    .getByText(/LUB-KAM-\d{8}/)
    .first()
    .textContent();
  const taxpayerNo = /LUB-KAM-\d{8}/.exec(idText ?? "")![0];

  // 2. The welcome SMS was queued with a portal link; plant a second link we know the token of.
  const token = randomBytes(24).toString("base64url");
  const { invoiceNo, invoiceToken } = await withDb(async (c) => {
    const tp = await c.query<{ id: string }>(
      "select id from app.taxpayers where taxpayer_no = $1",
      [taxpayerNo],
    );
    const welcome = await c.query<{ payload: { portalUrl?: string } }>(
      "select payload from app.notifications where taxpayer_id = $1 and template_key = 'registration'",
      [tp.rows[0]!.id],
    );
    expect(welcome.rows[0]?.payload.portalUrl).toMatch(/\/t\/[A-Za-z0-9_-]+$/);
    await c.query(
      "insert into app.portal_links (taxpayer_id, token_hash, purpose, expires_at) values ($1, $2, 'e2e', now() + interval '1 day')",
      [tp.rows[0]!.id, createHash("sha256").update(token).digest("hex")],
    );
    const o = await c.query<{ invoice_no: string; invoice_token: string }>(
      "select invoice_no, invoice_token from app.obligations where taxpayer_id = $1 order by period_start limit 1",
      [tp.rows[0]!.id],
    );
    return { invoiceNo: o.rows[0]!.invoice_no, invoiceToken: o.rows[0]!.invoice_token };
  });

  // 3. The taxpayer opens the link on their phone: no login, no password.
  const phone = await context.browser()!.newContext({ viewport: { width: 390, height: 780 } });
  const p = await phone.newPage();
  await p.goto(`/t/${token}`);
  await expect(p).toHaveURL(/\/p$/);
  await expect(p.getByText("Vous devez")).toBeVisible();
  await expect(p.getByText("5 000 FC").first()).toBeVisible();
  await expect(p.getByText(taxpayerNo)).toBeVisible();
  await expect(p.getByText("Aucun reçu pour l’instant.")).toBeVisible();

  // 4. Pay: the amount comes from the server, the status from the provider.
  await p.getByRole("link", { name: "Payer maintenant" }).click();
  await expect(p.getByText("Choisir le moyen de paiement")).toBeVisible();
  await expect(p.getByText("Pris en charge par la Mairie")).toBeVisible();
  await p.getByRole("button", { name: /Airtel Money/ }).click();
  await p.getByRole("button", { name: /^Payer 5 000 FC$/ }).click();
  await expect(p.getByText("Confirmez la demande sur votre téléphone…")).toBeVisible();
  // Regex matchers see the raw text: amounts carry U+00A0, so match them with \s.
  await expect(
    p.getByText(/Votre paiement de 5\s000\sFC est confirmé par Airtel Money/),
  ).toBeVisible({ timeout: 20_000 });
  await expect(p.getByText(/RCP-\d{4}-\d{6}/)).toBeVisible();
  await expect(p.getByAltText("Vérifiez ce reçu")).toBeVisible();
  await p.getByRole("link", { name: "Retour à mon compte" }).click();
  await expect(p.getByText("Vous êtes à jour")).toBeVisible();
  await expect(p.getByText(/RCP-\d{4}-\d{6} · Airtel Money/)).toBeVisible();

  // 5. Complaint with the category added on purpose.
  await p.getByRole("link", { name: "Signaler un problème" }).click();
  await p.getByLabel("Objet").selectOption({ label: "Les déchets ne sont pas collectés" });
  await p.getByLabel("Description").fill("Aucune collecte cette semaine sur l’avenue.");
  await p.getByRole("button", { name: "Envoyer" }).click();
  await expect(p.getByText("Votre demande a été enregistrée.")).toBeVisible();
  await expect(p.getByText(/Les déchets ne sont pas collectés/).last()).toBeVisible();
  await expect(p.getByText("Ouvert")).toBeVisible();

  // 6. The avis d'imposition QR: authentic, already paid; a wrong token is refused.
  await p.goto(`/f/${invoiceNo}/${invoiceToken}`);
  await expect(p.getByText("Avis authentique")).toBeVisible();
  await expect(p.getByText(invoiceNo).first()).toBeVisible();
  await expect(p.getByText("Cet avis est réglé.")).toBeVisible();
  await p.goto(`/f/${invoiceNo}/${"0".repeat(32)}`);
  await expect(p.getByText("Avis inconnu")).toBeVisible();

  // 7. An expired or unknown link lands on the French message; a stale cookie too.
  await p.goto("/t/not-a-real-token");
  await expect(p.getByText("Lien expiré")).toBeVisible();
  await phone.close();
});

test("door sticker landing offers a new link by SMS and never shows the balance", async ({
  page,
}) => {
  await page.goto("/q/LUB-KAM-00000125");
  await expect(page.getByText("LUB-KAM-00000125")).toBeVisible();
  await expect(page.getByText("Vous devez")).toHaveCount(0);
  await page.getByRole("button", { name: "Recevoir mon lien par SMS" }).click();
  // First call sends (or hits the 10-minute cooldown from a previous run): either way, no balance leaks.
  await expect(page.getByText(/Un SMS a été envoyé|déjà été envoyé/).first()).toBeVisible();
  await page.goto("/q/LUB-XXX-99999999");
  await expect(page.getByText("Contribuable inconnu")).toBeVisible();
});
