import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL(".", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["lib/**"],
      exclude: ["lib/**/*.test.ts", "lib/db/schema/**"],
      reporter: ["text", "html"],
      // CLAUDE.md: the tax engine (and, from M5, the payment state machine) must be 100 % covered.
      thresholds: {
        "lib/tax-engine/**": { lines: 100, functions: 100, branches: 100, statements: 100 },
        // The payment state machine and its pure companions must be 100 % covered; the
        // database-bound service is exercised by the integration project.
        "lib/payments/state-machine.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        "lib/payments/reference.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
        "lib/payments/providers/**": { lines: 100, functions: 100, branches: 100, statements: 100 },
        "lib/payments/registry.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
        "lib/payments/service.ts": { lines: 85, functions: 90, branches: 65, statements: 85 },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "lib/**/*.test.ts"],
        },
      },
      {
        // Needs the local Supabase stack (`supabase start`, `pnpm db:migrate`).
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
