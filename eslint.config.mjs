import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Prettier owns formatting; this switches off the ESLint rules that would fight it.
  prettier,
  // CLAUDE.md: nothing outside lib/payments may import a provider directly.
  {
    files: ["**/*.{ts,tsx,mts}"],
    ignores: ["lib/payments/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/payments/providers/*", "**/payments/providers/*"],
              message:
                "Use lib/payments/registry.getProvider(); providers are internal to lib/payments.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "drizzle/**",
  ]),
]);

export default eslintConfig;
