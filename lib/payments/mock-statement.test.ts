import { describe, expect, it } from "vitest";

import { perturbStatement } from "./mock-ledger";
import type { StatementLine } from "./provider";
import { createMockProvider, mockProvider } from "./providers/mock";

const line = (n: number, hour: number): StatementLine => ({
  providerReference: `MK${n}`,
  platformReference: `TX-${n}`,
  amountFc: 1000 * n,
  occurredAt: new Date(`2026-09-12T${String(hour).padStart(2, "0")}:00:00+02:00`),
  payerPhone: "+243990000000",
  raw: {},
});

describe("mock statement (M9: one missing, one duplicate, one unknown)", () => {
  it("drops the latest confirmation, doubles the previous one, adds an unknown line", () => {
    const out = perturbStatement([line(1, 9), line(3, 15), line(2, 12)], "2026-09-12", "mpesa");
    const refs = out.map((l) => l.providerReference);
    expect(refs).toEqual(["MK1", "MK2", "MK2-DUP", "AM-20260912-MPESA-001"]);
    expect(out.find((l) => l.providerReference === "MK2-DUP")?.platformReference).toBe("TX-2");
    const unknown = out[out.length - 1]!;
    expect(unknown.platformReference).toBeNull();
    expect(unknown.amountFc).toBe(5000);
    expect(unknown.raw).toMatchObject({ omitted: "MK3" });
  });

  it("an empty ledger still yields the unknown line", () => {
    const out = perturbStatement([], "2026-09-12", "airtel");
    expect(out).toHaveLength(1);
    expect(out[0]!.providerReference).toBe("AM-20260912-AIRTEL-001");
  });

  it("a payment confirmed from a statement (attached) is never the missing or duplicated one", () => {
    const attached = { ...line(9, 18), raw: { origin: "counter" } };
    const out = perturbStatement([line(1, 9), line(2, 12), attached], "2026-09-12", "mpesa");
    const refs = out.map((l) => l.providerReference);
    expect(refs).toEqual(["MK1", "MK9", "MK1-DUP", "AM-20260912-MPESA-001"]);
  });

  it("the mock provider delegates to its statement source, or reports nothing without one", async () => {
    expect(await mockProvider.fetchStatement("2026-09-12")).toEqual([]);
    const withSource = createMockProvider(async (date, channel) => [
      { ...line(7, 10), raw: { date, channel } },
    ]);
    const lines = await withSource.fetchStatement("2026-09-12", "orange");
    expect(lines[0]!.raw).toEqual({ date: "2026-09-12", channel: "orange" });
    expect((await withSource.fetchStatement("2026-09-12"))[0]!.raw).toEqual({
      date: "2026-09-12",
      channel: "mock",
    });
  });
});
