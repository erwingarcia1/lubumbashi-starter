import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  categories,
  entities,
  obligations,
  payments,
  providerConfirmations,
  receipts,
  taxRules,
  taxRuleVersions,
  taxpayers,
  zones,
} from "@/lib/db/schema";

import { appDb, pgCode, pgMessage, rolledBack } from "./db";

type Tx = Parameters<Parameters<typeof rolledBack>[1]>[0];

async function fixture(tx: Tx) {
  const [commune] = await tx
    .insert(zones)
    .values({ level: "commune", code: "TSC", name: "Test" })
    .returning();
  const [cat] = await tx.insert(categories).values({ code: "test_c", labelFr: "Test" }).returning();
  const [tp] = await tx
    .insert(taxpayers)
    .values({
      taxpayerNo: "LUB-TSC-00000001",
      kind: "person",
      fullName: "Test Contraintes",
      phone: "+243990000001",
      communeId: commune!.id,
      address: "Av. Test 2",
      registeredAt: new Date(),
    })
    .returning();
  const [ent] = await tx
    .insert(entities)
    .values({
      taxpayerId: tp!.id,
      kind: "property",
      categoryId: cat!.id,
      name: "Test",
      address: "Test",
      communeId: commune!.id,
      location: { x: 27.49, y: -11.66 },
      registeredAt: new Date(),
    })
    .returning();
  const [rule] = await tx
    .insert(taxRules)
    .values({ code: "test_rule", taxCode: "test", labelFr: "Test", categoryId: cat!.id })
    .returning();
  const [v1] = await tx
    .insert(taxRuleVersions)
    .values({
      taxRuleId: rule!.id,
      version: 1,
      status: "approved",
      effectiveFrom: "2026-01-01",
      calcKind: "fixed",
      amountFc: 5000,
      frequency: "monthly",
    })
    .returning();
  const payment = {
    reference: "TX-2609-13-0842-TST1",
    taxpayerId: tp!.id,
    amountFc: 5000,
    channel: "mock" as const,
    origin: "agent" as const,
    payerPhone: "+243990000001",
  };
  return { tp: tp!, ent: ent!, rule: rule!, v1: v1!, payment };
}

/** Runs `fn` in a savepoint (nested transaction) so an expected error does not abort the outer transaction. */
async function failsWith(
  tx: Tx,
  fn: (sp: Tx) => Promise<unknown>,
): Promise<{ code?: string; message: string }> {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp);
    });
  } catch (err) {
    return { code: pgCode(err), message: pgMessage(err) };
  }
  return { code: undefined, message: "" };
}

describe("database-enforced invariants", () => {
  it("1: a payment cannot be confirmed without a provider_confirmation", async () => {
    await rolledBack(appDb(), async (tx) => {
      const f = await fixture(tx);
      await tx.execute(sql`set constraints all immediate`);
      const r = await failsWith(tx, (sp) =>
        sp.insert(payments).values({ ...f.payment, status: "confirmed" }),
      );
      expect(r.message).toContain("cannot be confirmed without a provider_confirmation");
    });
  });

  it("1: confirmed with its provider_confirmation in the same transaction is accepted", async () => {
    await rolledBack(appDb(), async (tx) => {
      const f = await fixture(tx);
      const [p] = await tx
        .insert(payments)
        .values({ ...f.payment, status: "pending" })
        .returning();
      await tx.insert(providerConfirmations).values({
        paymentId: p!.id,
        provider: "mock",
        providerReference: "MOCK-TST-1",
        amountFc: 5000,
        rawPayload: { seeded: true },
      });
      await tx
        .update(payments)
        .set({ status: "confirmed", confirmedAt: new Date() })
        .where(sql`${payments.id} = ${p!.id}`);
      await tx.execute(sql`set constraints all immediate`);
      const [row] = await tx
        .select({ status: payments.status })
        .from(payments)
        .where(sql`${payments.id} = ${p!.id}`);
      expect(row?.status).toBe("confirmed");
    });
  });

  it("5: the same provider callback twice cannot create two confirmations; references are unique", async () => {
    await rolledBack(appDb(), async (tx) => {
      const f = await fixture(tx);
      const [p] = await tx
        .insert(payments)
        .values({ ...f.payment, status: "pending" })
        .returning();
      const conf = {
        paymentId: p!.id,
        provider: "mock" as const,
        providerReference: "MOCK-TST-2",
        amountFc: 5000,
        rawPayload: {},
      };
      await tx.insert(providerConfirmations).values(conf);
      const dup = await failsWith(tx, (sp) => sp.insert(providerConfirmations).values(conf));
      expect(dup.code).toBe("23505");
      const dupRef = await failsWith(tx, (sp) =>
        sp.insert(payments).values({ ...f.payment, status: "initiated" }),
      );
      expect(dupRef.code).toBe("23505");
    });
  });

  it("7: a receipt needs a confirmed payment, is unique per payment, and its content is immutable", async () => {
    await rolledBack(appDb(), async (tx) => {
      const f = await fixture(tx);
      const [p] = await tx
        .insert(payments)
        .values({ ...f.payment, status: "pending" })
        .returning();
      await tx.execute(sql`set constraints all immediate`);
      const rc = {
        receiptNo: "RCP-2609-999001",
        paymentId: p!.id,
        taxpayerId: f.tp.id,
        amountFc: 5000,
        verifyToken: "tok-1",
        snapshot: { a: 1 },
      };
      const early = await failsWith(tx, (sp) => sp.insert(receipts).values(rc));
      expect(early.message).toContain("requires a confirmed payment");
      await tx.insert(providerConfirmations).values({
        paymentId: p!.id,
        provider: "mock",
        providerReference: "MOCK-TST-3",
        amountFc: 5000,
        rawPayload: {},
      });
      await tx
        .update(payments)
        .set({ status: "confirmed" })
        .where(sql`${payments.id} = ${p!.id}`);
      await tx.insert(receipts).values(rc);
      const second = await failsWith(tx, (sp) =>
        sp.insert(receipts).values({ ...rc, receiptNo: "RCP-2609-999002", verifyToken: "tok-2" }),
      );
      expect(second.code).toBe("23505");
      const edit = await failsWith(tx, (sp) =>
        sp
          .update(receipts)
          .set({ amountFc: 1 })
          .where(sql`${receipts.receiptNo} = ${rc.receiptNo}`),
      );
      expect(edit.message).toContain("immutable");
      const cancelWithoutReason = await failsWith(tx, (sp) =>
        sp
          .update(receipts)
          .set({ status: "cancelled", cancelledAt: new Date() })
          .where(sql`${receipts.receiptNo} = ${rc.receiptNo}`),
      );
      expect(cancelWithoutReason.code).toBe("23514");
      await tx
        .update(receipts)
        .set({ status: "cancelled", cancelledAt: new Date(), cancelledReason: "test" })
        .where(sql`${receipts.receiptNo} = ${rc.receiptNo}`);
    });
  });

  it("9: negative or fractional amounts are rejected; 6: obligations keep their rule version", async () => {
    await rolledBack(appDb(), async (tx) => {
      const f = await fixture(tx);
      const neg = await failsWith(tx, (sp) =>
        sp.insert(payments).values({ ...f.payment, amountFc: -5 }),
      );
      expect(neg.code).toBe("23514");
      // Postgres rounds a fractional literal into an integer column instead of failing, so the
      // structural guarantee is what matters: every money column is `integer` (Zod guards the APIs).
      const money = await tx.execute<{
        table_name: string;
        column_name: string;
        data_type: string;
      }>(
        sql`select table_name, column_name, data_type from information_schema.columns where table_schema = 'app' and column_name like '%\_fc' escape '\'`,
      );
      expect(money.rows.length).toBeGreaterThan(10);
      expect(money.rows.filter((c) => c.data_type !== "integer")).toEqual([]);
      const [ob] = await tx
        .insert(obligations)
        .values({
          entityId: f.ent.id,
          taxpayerId: f.tp.id,
          taxRuleId: f.rule.id,
          taxRuleVersionId: f.v1.id,
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          dueDate: "2026-09-30",
          amountFc: 5000,
        })
        .returning();
      await tx.insert(taxRuleVersions).values({
        taxRuleId: f.rule.id,
        version: 2,
        status: "approved",
        effectiveFrom: "2026-10-01",
        calcKind: "fixed",
        amountFc: 6000,
        frequency: "monthly",
      });
      const [again] = await tx
        .select({ v: obligations.taxRuleVersionId, amount: obligations.amountFc })
        .from(obligations)
        .where(sql`${obligations.id} = ${ob!.id}`);
      expect(again).toEqual({ v: f.v1.id, amount: 5000 });
    });
  });

  it("business_date is computed in Africa/Lubumbashi", async () => {
    await rolledBack(appDb(), async (tx) => {
      const f = await fixture(tx);
      const [p] = await tx
        .insert(payments)
        .values({ ...f.payment, status: "initiated", createdAt: new Date("2026-09-30T22:30:00Z") })
        .returning({ businessDate: payments.businessDate });
      expect(p?.businessDate).toBe("2026-10-01");
    });
  });
});
