import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
// Against a remote server (database in another region) every action takes seconds, not milliseconds.
const remote = !!process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? "github" : "list",
  timeout: remote ? 180_000 : 30_000,
  expect: { timeout: remote ? 30_000 : 5_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // M4 adds a Pixel-class mobile project for the agent and portal flows.
  ],
  webServer: {
    // Locally the dev server is reused if already running. In CI run `pnpm build` first.
    command: isCI ? "pnpm start" : "pnpm dev",
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
