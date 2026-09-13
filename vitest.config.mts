import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "lib/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**"],
      exclude: ["lib/**/*.test.ts"],
      reporter: ["text", "html"],
      // M2 and M5 add 100 % thresholds for lib/tax-engine and lib/payments (CLAUDE.md).
    },
  },
});
