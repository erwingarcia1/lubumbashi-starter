import { expect, test } from "@playwright/test";

/**
 * CLAUDE.md: at most 500 KB transferred (compressed) on a cold first navigation to /agent.
 * Meaningful only against a production build: `pnpm build && BUDGET_CHECK=1 pnpm start`
 * then `BUDGET_CHECK=1 pnpm exec playwright test tests/e2e/agent-budget.spec.ts`.
 */
test.skip(!process.env.BUDGET_CHECK, "run against a production build with BUDGET_CHECK=1");

test("cold first load of the agent login stays under 500 KB transferred", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  const client = await context.newCDPSession(page);
  await client.send("Network.enable");
  let transferred = 0;
  client.on("Network.loadingFinished", (e) => {
    transferred += e.encodedDataLength;
  });
  await page.goto("/agent/login", { waitUntil: "networkidle" });
  await expect(page.getByLabel("Matricule agent")).toBeVisible();
  console.log(`agent first load: ${(transferred / 1024).toFixed(0)} KB transferred`);
  expect(transferred).toBeLessThan(500 * 1024);
});
