import { describe, expect, it } from "vitest";

import { fr } from "@/lib/i18n/fr";

function leaves(value: unknown, path: string[] = []): Array<[string, unknown]> {
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      leaves(child, [...path, key]),
    );
  }
  return [[path.join("."), value]];
}

describe("lib/i18n/fr", () => {
  it("has the M0 demo title exactly", () => {
    expect(fr.app.title).toBe("Plateforme de recouvrement — Ville de Lubumbashi");
  });

  it("has only non-empty strings as leaves", () => {
    const all = leaves(fr);
    expect(all.length).toBeGreaterThan(0);
    for (const [key, value] of all) {
      expect(typeof value, key).toBe("string");
      expect((value as string).trim().length, key).toBeGreaterThan(0);
    }
  });
});
