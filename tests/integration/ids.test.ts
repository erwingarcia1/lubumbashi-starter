import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { allocateReceiptNo, allocateTaxpayerId } from "@/lib/identity/ids";

import { appDb } from "./db";

const CODE = "TST";
const YEAR = 2099;

async function reset() {
  await appDb().execute(sql`delete from app.id_counters where commune_code = ${CODE}`);
  await appDb().execute(sql`delete from app.receipt_counters where year = ${YEAR}`);
}

describe("gapless counters (invariant 7 and taxpayer ids)", () => {
  beforeAll(reset);
  afterAll(reset);

  it("allocates sequential ids per commune", async () => {
    const db = appDb();
    const a = await db.transaction((tx) => allocateTaxpayerId(tx, CODE));
    const b = await db.transaction((tx) => allocateTaxpayerId(tx, CODE));
    expect([a, b]).toEqual(["LUB-TST-00000001", "LUB-TST-00000002"]);
  });

  it("does not consume a number when the transaction rolls back", async () => {
    const db = appDb();
    await expect(
      db.transaction(async (tx) => {
        await allocateTaxpayerId(tx, CODE);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    const next = await db.transaction((tx) => allocateTaxpayerId(tx, CODE));
    expect(next).toBe("LUB-TST-00000003");
  });

  it("stays gapless and unique under 20 concurrent allocations", async () => {
    const db = appDb();
    const ids = await Promise.all(
      Array.from({ length: 20 }, () => db.transaction((tx) => allocateTaxpayerId(tx, CODE))),
    );
    const numbers = ids.map((id) => Number(id.slice(-8))).sort((x, y) => x - y);
    expect(new Set(numbers).size).toBe(20);
    expect(numbers[0]).toBe(4);
    expect(numbers[19]).toBe(23);
  });

  it("numbers receipts gaplessly per business year with the month in the prefix", async () => {
    const db = appDb();
    const sept = await db.transaction((tx) =>
      allocateReceiptNo(tx, new Date(`${YEAR}-09-13T08:44:00+02:00`)),
    );
    const oct = await db.transaction((tx) =>
      allocateReceiptNo(tx, new Date(`${YEAR}-09-30T22:30:00Z`)),
    );
    expect(sept).toBe("RCP-9909-000001");
    expect(oct).toBe("RCP-9910-000002");
  });
});
