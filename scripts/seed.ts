import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

// CLAUDE.md invariant 1: seeded "confirmed" payments can only exist through the mock provider,
// which must never run in production. The seed therefore refuses production outright.
if (process.env.NODE_ENV === "production") {
  console.error("seed: refusing to run with NODE_ENV=production");
  process.exit(1);
}

console.log("seed: nothing to seed yet. M1 adds the schema and the prototype data.");
