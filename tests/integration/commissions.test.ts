import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { agentMonthView } from "@/lib/commissions/agent-view";
import { computeStatement } from "@/lib/commissions/compute";
import { previousPeriod } from "@/lib/commissions/period";
import {
  commissionAmount,
  createCommissionRule,
  listRules,
  ruleFor,
} from "@/lib/commissions/rules";
import {
  approveStatement,
  listStatements,
  markPaid,
  upsertDraft,
} from "@/lib/commissions/statements";
import {
  admins,
  agents,
  auditLog,
  commissionLines,
  commissionStatements,
  devices,
  payments,
  providerConfirmations,
  taxpayers,
  zones,
} from "@/lib/db/schema";
import type { AdminSession } from "@/lib/identity/session";
import { refreshDraftStatements } from "@/lib/jobs/commissions";
import { buildReport } from "@/lib/reports";
import { runSeed } from "@/scripts/seed";

import { appDb } from "./db";

const YEAR = 2100 + Math.floor(Math.random() * 800);
const PERIOD = `${YEAR}-06`;
let finances: AdminSession;
let admin: AdminSession;
let superviseur: AdminSession;
let agent: typeof agents.$inferSelect;
let device: typeof devices.$inferSelect;
let taxpayer: typeof taxpayers.$inferSelect;
let communeId: string;

const SUFFIX = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const suffix = () =>
  Array.from({ length: 4 }, () => SUFFIX[Math.floor(Math.random() * SUFFIX.length)]).join("");

/** A confirmed (or reversed) collection by the agent on a given day, written like the seed does. */
async function collect(
  day: string,
  amountFc: number,
  opts: { reversedOn?: string } = {},
): Promise<string> {
  const db = appDb();
  const at = new Date(`${day}T10:15:00+02:00`);
  const reference = `TX-${String(YEAR).slice(-2)}${day.slice(5, 7)}-${day.slice(8, 10)}-1015-${suffix()}`;
  await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(payments)
      .values({
        reference,
        taxpayerId: taxpayer.id,
        amountFc,
        channel: "mock",
        origin: "agent",
        payerPhone: taxpayer.phone,
        status: opts.reversedOn ? "reversed" : "confirmed",
        initiatedByAgentId: agent.id,
        initiatedDeviceId: device.id,
        createdAt: at,
        pendingAt: at,
        confirmedAt: new Date(at.getTime() + 45_000),
        reversedAt: opts.reversedOn ? new Date(`${opts.reversedOn}T09:00:00+02:00`) : null,
      })
      .returning({ id: payments.id });
    await tx.insert(providerConfirmations).values({
      paymentId: p!.id,
      provider: "mock",
      providerReference: `CM-${reference}`,
      amountFc,
      rawPayload: { test: "commissions" },
      receivedAt: new Date(at.getTime() + 45_000),
      createdAt: new Date(at.getTime() + 45_000),
    });
  });
  return reference;
}

async function register(day: string): Promise<string> {
  const no = `LUB-KAM-9${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
  await appDb()
    .insert(taxpayers)
    .values({
      taxpayerNo: no,
      kind: "person",
      fullName: `Commission Test ${no.slice(-4)}`,
      phone: `+24399${no.slice(-7)}`,
      communeId,
      address: "Av. Test 1",
      registeredAt: new Date(`${day}T08:30:00+02:00`),
      registeredByAgentId: agent.id,
      registeredDeviceId: device.id,
    });
  return no;
}

describe("agent commissions (D36): compute, drafts, approval, payout, scale", () => {
  beforeAll(async () => {
    const db = appDb();
    await runSeed(db);
    const row = async (email: string) =>
      (await db.select().from(admins).where(eq(admins.email, email)))[0]!;
    const session = (a: typeof admins.$inferSelect) =>
      ({ adminId: a.id, email: a.email, fullName: a.fullName, role: a.role }) as AdminSession;
    finances = session(await row("ngoy.k@lubumbashi.cd"));
    admin = session(await row("admin@lubumbashi.cd"));
    superviseur = session(await row("ilunga.m@lubumbashi.cd"));
    agent = (await db.select().from(agents).where(eq(agents.matricule, "AG-KAM-007")))[0]!;
    device = (await db.select().from(devices).where(eq(devices.deviceCode, "DEV-3F9A")))[0]!;
    taxpayer = (
      await db.select().from(taxpayers).where(eq(taxpayers.taxpayerNo, "LUB-KAM-00000131"))
    )[0]!;
    communeId = (
      await db
        .select({ id: zones.id })
        .from(zones)
        .where(and(eq(zones.level, "commune"), eq(zones.code, "KAM")))
    )[0]!.id;
  }, 120_000);

  it("computes the seeded month of AG-KAM-007 from the ledger, 5 % per collection and 500 FC per household", async () => {
    const db = appDb();
    const c = await computeStatement(db, agent.id, "2026-09");
    const confirmed = await db
      .select({ amountFc: payments.amountFc, status: payments.status })
      .from(payments)
      .where(
        and(
          eq(payments.initiatedByAgentId, agent.id),
          sql`${payments.confirmedAt} is not null`,
          sql`${payments.status} in ('confirmed', 'reversed')`,
          sql`${payments.businessDate} between '2026-09-01' and '2026-09-30'`,
        ),
      );
    const reversals = await db
      .select({ amountFc: payments.amountFc })
      .from(payments)
      .where(
        and(
          eq(payments.initiatedByAgentId, agent.id),
          eq(payments.status, "reversed"),
          sql`util.business_date(${payments.reversedAt}) between '2026-09-01' and '2026-09-30'`,
        ),
      );
    const registered = (
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(taxpayers)
        .where(
          and(
            eq(taxpayers.registeredByAgentId, agent.id),
            sql`util.business_date(${taxpayers.registeredAt}) between '2026-09-01' and '2026-09-30'`,
          ),
        )
    )[0]!.n;
    expect(confirmed.length).toBeGreaterThan(0);
    const earned = confirmed.reduce((s, p) => s + commissionAmount(p.amountFc, 500), 0);
    const deducted = reversals.reduce((s, p) => s + commissionAmount(p.amountFc, 500), 0);
    expect(c.totals).toEqual({
      collectionsCount: confirmed.length,
      collectedFc: confirmed.reduce((s, p) => s + p.amountFc, 0),
      collectionCommissionFc: earned - deducted,
      registrationsCount: registered,
      registrationCommissionFc: registered * 500,
      totalFc: earned - deducted + registered * 500,
    });
    expect(c.lines.filter((l) => l.kind === "reversal").every((l) => l.amountFc < 0)).toBe(true);
    // The seeded 4 September collection (5 000 FC) is worth 250 FC.
    expect(
      c.lines.find((l) => l.businessDate === "2026-09-04" && l.kind === "collection"),
    ).toMatchObject({ baseFc: 5000, rateBp: 500, amountFc: 250 });

    // A month without anything: zero totals, no lines.
    const empty = await computeStatement(db, agent.id, `${YEAR}-01`);
    expect(empty.totals.totalFc).toBe(0);
    expect(empty.lines).toEqual([]);
  });

  it("drafts are idempotent; approval freezes the lines and is audited; payout needs a reference; Superviseur refused", async () => {
    const db = appDb();
    const rules = await listRules(db);
    const pct = ruleFor(rules, "collection_percent", `${YEAR}-06-15`)!.rateBp;
    const fixed = ruleFor(rules, "registration_fixed", `${YEAR}-06-15`)!.amountFc;
    await collect(`${YEAR}-06-03`, 5000);
    await collect(`${YEAR}-06-10`, 10500);
    // Collected in May, reversed in June: a negative line in June only.
    await collect(`${YEAR}-05-20`, 8000, { reversedOn: `${YEAR}-06-12` });
    await register(`${YEAR}-06-05`);

    const first = await upsertDraft(db, agent.id, PERIOD);
    const again = await upsertDraft(db, agent.id, PERIOD);
    expect(again.id).toBe(first.id);
    expect(again.status).toBe("draft");
    const expected = {
      collectionsCount: 2,
      collectedFc: 15500,
      collectionCommissionFc:
        commissionAmount(5000, pct) + commissionAmount(10500, pct) - commissionAmount(8000, pct),
      registrationsCount: 1,
      registrationCommissionFc: fixed,
    };
    expect(again).toMatchObject({
      ...expected,
      totalFc: expected.collectionCommissionFc + expected.registrationCommissionFc,
    });
    const lines = await db
      .select()
      .from(commissionLines)
      .where(eq(commissionLines.statementId, first.id));
    expect(lines).toHaveLength(4);
    expect(lines.find((l) => l.kind === "reversal")).toMatchObject({
      businessDate: `${YEAR}-06-12`,
      baseFc: 8000,
      amountFc: -commissionAmount(8000, pct),
    });
    // May's draft shows the collection, not the reversal.
    const may = await computeStatement(db, agent.id, previousPeriod(PERIOD));
    expect(may.totals).toMatchObject({ collectionsCount: 1, collectedFc: 8000 });
    expect(may.lines.some((l) => l.kind === "reversal")).toBe(false);

    // Roles: the Superviseur can neither approve nor pay.
    await expect(approveStatement(db, superviseur, first.id)).rejects.toThrow(/forbidden/);
    await expect(markPaid(db, superviseur, first.id, { reference: "VIR-1" })).rejects.toThrow(
      /forbidden/,
    );
    // Not approved yet: cannot be paid.
    await expect(markPaid(db, finances, first.id, { reference: "VIR-TEST" })).rejects.toThrow(
      /invalid_state/,
    );

    const approved = await approveStatement(db, finances, first.id, {
      ip: "10.0.0.5",
      userAgent: "vitest",
    });
    expect(approved.status).toBe("approved");
    expect(approved.approvedByAdminId).toBe(finances.adminId);
    expect(approved.totalFc).toBe(again.totalFc);
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "commission_statement.approved"),
          eq(auditLog.objectId, `AG-KAM-007/${PERIOD}`),
        ),
      );
    expect(audit).toMatchObject({
      actorType: "admin",
      actorId: finances.adminId,
      actorRole: "finances",
      actorLabel: "ngoy.k@lubumbashi.cd",
      ip: "10.0.0.5",
      userAgent: "vitest",
    });
    await expect(approveStatement(db, finances, first.id)).rejects.toThrow(/invalid_state/);

    // Frozen: a new collection changes the live computation, not the statement.
    await collect(`${YEAR}-06-20`, 6000);
    const live = await computeStatement(db, agent.id, PERIOD);
    expect(live.totals.collectionsCount).toBe(3);
    const frozen = await upsertDraft(db, agent.id, PERIOD);
    expect(frozen.status).toBe("approved");
    expect(frozen.totalFc).toBe(approved.totalFc);
    expect(
      await db.select().from(commissionLines).where(eq(commissionLines.statementId, first.id)),
    ).toHaveLength(4);
    const job = await refreshDraftStatements(db, PERIOD);
    expect(job.frozen).toBeGreaterThanOrEqual(1);
    expect(job.refreshed).toBeGreaterThanOrEqual(1);
    expect(
      (
        await db.select().from(commissionStatements).where(eq(commissionStatements.id, first.id))
      )[0]!.totalFc,
    ).toBe(approved.totalFc);

    // The agent's view: frozen figures, status, and the month in its list of other months.
    const view = await agentMonthView(db, agent.id, PERIOD);
    expect(view).toMatchObject({ status: "approved", live: false });
    expect(view.totals.totalFc).toBe(approved.totalFc);
    expect(view.days.map((d) => d.date)).toEqual([
      `${YEAR}-06-12`,
      `${YEAR}-06-10`,
      `${YEAR}-06-05`,
      `${YEAR}-06-03`,
    ]);
    const other = await agentMonthView(db, agent.id, "2026-09");
    expect(other.months.some((m) => m.period === PERIOD && m.status === "approved")).toBe(true);

    // Payout: reference mandatory, then paid once.
    await expect(markPaid(db, finances, first.id, { reference: "" })).rejects.toThrow(
      /invalid_input/,
    );
    await expect(markPaid(db, finances, first.id, { reference: "  " })).rejects.toThrow(
      /invalid_input/,
    );
    const paid = await markPaid(
      db,
      admin,
      first.id,
      { reference: `VIR-${PERIOD}-001` },
      { ip: "10.0.0.6" },
    );
    expect(paid).toMatchObject({ status: "paid", paidReference: `VIR-${PERIOD}-001` });
    expect(paid.paidByAdminId).toBe(admin.adminId);
    const paidAudit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "commission_statement.paid"),
          eq(auditLog.objectId, `AG-KAM-007/${PERIOD}`),
        ),
      );
    expect(paidAudit).toHaveLength(1);
    expect(paidAudit[0]!.ip).toBe("10.0.0.6");
    await expect(markPaid(db, finances, first.id, { reference: "VIR-AGAIN" })).rejects.toThrow(
      /invalid_state/,
    );

    // The dashboard table and the Excel report carry the frozen row.
    const table = await listStatements(db, PERIOD);
    const mine = table.find((r) => r.matricule === "AG-KAM-007")!;
    expect(mine).toMatchObject({ status: "paid", stored: true, totalFc: approved.totalFc });
    expect(table.filter((r) => r.matricule !== "AG-KAM-007").every((r) => r.stored)).toBe(true);
    const file = await buildReport(db, "commissions", { format: "xlsx", month: PERIOD });
    expect(file.rows).toBe(table.length);
    expect(file.body.subarray(0, 2).toString()).toBe("PK");
  });

  it("the Administrateur adds a scale version at a future date; Finances cannot; nothing is edited", async () => {
    const db = appDb();
    const before = await listRules(db);
    const day = `${YEAR + 1}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, "0")}`;
    await expect(
      createCommissionRule(db, finances, {
        basis: "collection_percent",
        rateBp: 600,
        effectiveFrom: day,
      }),
    ).rejects.toThrow(/forbidden/);
    await expect(
      createCommissionRule(db, admin, {
        basis: "collection_percent",
        rateBp: 600,
        effectiveFrom: "2020-01-01",
      }),
    ).rejects.toThrow(/invalid_input/);
    await expect(
      createCommissionRule(db, admin, { basis: "collection_percent", effectiveFrom: day }),
    ).rejects.toThrow();
    const created = await createCommissionRule(
      db,
      admin,
      { basis: "collection_percent", rateBp: 600, effectiveFrom: day },
      { ip: "10.0.0.7" },
    );
    expect(created).toMatchObject({
      code: "collection_percent",
      basis: "collection_percent",
      rateBp: 600,
      amountFc: 0,
      effectiveFrom: day,
      createdByAdminId: admin.adminId,
    });
    await expect(
      createCommissionRule(db, admin, {
        basis: "collection_percent",
        rateBp: 700,
        effectiveFrom: day,
      }),
    ).rejects.toThrow(/invalid_state/);
    const after = await listRules(db);
    expect(after).toHaveLength(before.length + 1);
    for (const r of before) expect(after.find((x) => x.id === r.id)).toEqual(r);
    expect(ruleFor(after, "collection_percent", day)?.rateBp).toBe(600);
    expect(ruleFor(after, "collection_percent", "2026-09-15")?.rateBp).toBe(500);
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "commission_rule.created"),
          eq(auditLog.objectId, `collection_percent@${day}`),
        ),
      );
    expect(audit!.actorLabel).toBe("admin@lubumbashi.cd");
    expect(audit!.ip).toBe("10.0.0.7");
  });
});
