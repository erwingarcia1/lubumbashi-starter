import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { agentMonthView } from "@/lib/commissions/agent-view";
import { computeStatement } from "@/lib/commissions/compute";
import { previousPeriod } from "@/lib/commissions/period";
import {
  commissionAmount,
  createCommissionRule,
  listRules,
  ruleEndOf,
  ruleFor,
  ruleState,
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
import { businessDate } from "@/lib/time";
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

/**
 * A confirmed (or reversed) collection by the agent, written like the seed does: initiated at
 * 10:15 on `day` and confirmed 45 s later unless `initiatedAt` / `confirmedAt` say otherwise.
 */
async function collect(
  day: string,
  amountFc: number,
  opts: { reversedOn?: string; initiatedAt?: string; confirmedAt?: string } = {},
): Promise<string> {
  const db = appDb();
  const at = new Date(opts.initiatedAt ?? `${day}T10:15:00+02:00`);
  const confirmedAt = opts.confirmedAt
    ? new Date(opts.confirmedAt)
    : new Date(at.getTime() + 45_000);
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
        confirmedAt,
        reversedAt: opts.reversedOn ? new Date(`${opts.reversedOn}T09:00:00+02:00`) : null,
      })
      .returning({ id: payments.id });
    await tx.insert(providerConfirmations).values({
      paymentId: p!.id,
      provider: "mock",
      providerReference: `CM-${reference}`,
      amountFc,
      rawPayload: { test: "commissions" },
      receivedAt: confirmedAt,
      createdAt: confirmedAt,
    });
  });
  return reference;
}

/**
 * A household registered by the agent: captured on `day` (the device's `registered_at`) and
 * written on the server the same day unless `createdOn` says the sync came later.
 */
async function register(day: string, opts: { createdOn?: string } = {}): Promise<string> {
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
      createdAt: new Date(`${opts.createdOn ?? day}T09:00:00+02:00`),
    });
  return no;
}

/** ISO day `n` days after an ISO day. */
function plusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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
    // Independent sums on the attribution columns: confirmed_at, reversed_at, created_at.
    const confirmed = await db
      .select({ amountFc: payments.amountFc, status: payments.status })
      .from(payments)
      .where(
        and(
          eq(payments.initiatedByAgentId, agent.id),
          sql`${payments.confirmedAt} is not null`,
          sql`${payments.status} in ('confirmed', 'reversed')`,
          sql`util.business_date(${payments.confirmedAt}) between '2026-09-01' and '2026-09-30'`,
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
            sql`util.business_date(${taxpayers.createdAt}) between '2026-09-01' and '2026-09-30'`,
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

  it("attributes an act to the month it reached the platform, so a closed month never swallows it", async () => {
    const db = appDb();
    const rules = await listRules(db);
    const AUG = `${YEAR}-08`;
    const SEP = `${YEAR}-09`;
    const OCT = `${YEAR}-10`;
    // A household captured and synced in August: August's.
    await register(`${AUG}-10`);
    // August is closed before the late acts arrive.
    const august = await upsertDraft(db, agent.id, AUG);
    const approved = await approveStatement(db, finances, august.id);
    expect(approved).toMatchObject({
      status: "approved",
      collectionsCount: 0,
      registrationsCount: 1,
    });

    // Initiated on 31 August at 23:50, confirmed by the provider on 1 September at 00:05:
    // `payments.business_date` says August, `confirmed_at` says September.
    const late = await collect(`${AUG}-31`, 7000, {
      initiatedAt: `${AUG}-31T23:50:00+02:00`,
      confirmedAt: `${SEP}-01T00:05:00+02:00`,
    });
    // Captured offline on 20 August, synced on 3 September: `registered_at` says August,
    // `created_at` says September.
    const synced = await register(`${AUG}-20`, { createdOn: `${SEP}-03` });
    const [lateRow] = await db
      .select({ id: payments.id, businessDate: payments.businessDate })
      .from(payments)
      .where(eq(payments.reference, late));
    expect(lateRow!.businessDate).toBe(`${AUG}-31`);
    const [syncedRow] = await db
      .select({ id: taxpayers.id })
      .from(taxpayers)
      .where(eq(taxpayers.taxpayerNo, synced));

    // Neither act is August's, live or frozen.
    const augustLive = await computeStatement(db, agent.id, AUG);
    expect(augustLive.totals).toMatchObject({ collectionsCount: 0, registrationsCount: 1 });
    expect(augustLive.lines.some((l) => l.paymentId === lateRow!.id)).toBe(false);
    expect(augustLive.lines.some((l) => l.taxpayerId === syncedRow!.id)).toBe(false);
    expect((await upsertDraft(db, agent.id, AUG)).totalFc).toBe(approved.totalFc);

    // Both are September's, dated by the server-side event, at September's rule.
    const pct = ruleFor(rules, "collection_percent", `${SEP}-01`)!;
    const fixed = ruleFor(rules, "registration_fixed", `${SEP}-03`)!;
    const september = await computeStatement(db, agent.id, SEP);
    expect(september.totals).toEqual({
      collectionsCount: 1,
      collectedFc: 7000,
      collectionCommissionFc: commissionAmount(7000, pct.rateBp),
      registrationsCount: 1,
      registrationCommissionFc: fixed.amountFc,
      totalFc: commissionAmount(7000, pct.rateBp) + fixed.amountFc,
    });
    expect(september.lines.find((l) => l.paymentId === lateRow!.id)).toMatchObject({
      kind: "collection",
      businessDate: `${SEP}-01`,
      ruleId: pct.id,
      baseFc: 7000,
    });
    expect(september.lines.find((l) => l.taxpayerId === syncedRow!.id)).toMatchObject({
      kind: "registration",
      businessDate: `${SEP}-03`,
      ruleId: fixed.id,
      amountFc: fixed.amountFc,
    });
    // The agent's screen groups by the same days.
    const view = await agentMonthView(db, agent.id, SEP);
    expect(view.days.map((d) => d.date)).toEqual([`${SEP}-03`, `${SEP}-01`]);

    // Reversed on 2 October: September keeps the collection, October carries the deduction.
    await db
      .update(payments)
      .set({ status: "reversed", reversedAt: new Date(`${OCT}-02T11:00:00+02:00`) })
      .where(eq(payments.id, lateRow!.id));
    expect((await computeStatement(db, agent.id, SEP)).totals).toEqual(september.totals);
    const october = await computeStatement(db, agent.id, OCT);
    expect(october.lines).toHaveLength(1);
    expect(october.lines[0]).toMatchObject({
      kind: "reversal",
      paymentId: lateRow!.id,
      businessDate: `${OCT}-02`,
      ruleId: pct.id,
      amountFc: -commissionAmount(7000, pct.rateBp),
    });
    expect(october.totals.totalFc).toBe(-commissionAmount(7000, pct.rateBp));
  });

  it("the Administrateur adds a scale version after the latest one; it closes the previous version; Finances cannot", async () => {
    const db = appDb();
    const before = await listRules(db);
    const today = businessDate(new Date());
    const latest = before
      .filter((r) => r.code === "collection_percent")
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]!;
    expect(latest.effectiveTo).toBeNull();
    // Strictly after the latest version and after today: re-runnable, whatever earlier runs left.
    const base = latest.effectiveFrom > today ? latest.effectiveFrom : today;
    const day = plusDays(base, 1 + Math.floor(Math.random() * 300));
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
      taxRuleId: latest.taxRuleId,
      effectiveFrom: day,
      effectiveTo: null,
      createdByAdminId: admin.adminId,
    });
    // Same date: already exists; earlier than the latest (now `day`): refused as input.
    await expect(
      createCommissionRule(db, admin, {
        basis: "collection_percent",
        rateBp: 700,
        effectiveFrom: day,
      }),
    ).rejects.toThrow(/invalid_state/);
    if (plusDays(base, 1) < day)
      await expect(
        createCommissionRule(db, admin, {
          basis: "collection_percent",
          rateBp: 700,
          effectiveFrom: plusDays(base, 1),
        }),
      ).rejects.toThrow(/invalid_input/);
    const after = await listRules(db);
    expect(after).toHaveLength(before.length + 1);
    // The previous latest version now ends the day the new one starts; nothing else moved.
    for (const r of before)
      expect(after.find((x) => x.id === r.id)).toEqual(
        r.id === latest.id ? { ...r, effectiveTo: day } : r,
      );
    // The engine picks one version on each side of the date.
    expect(ruleFor(after, "collection_percent", plusDays(day, -1))?.id).toBe(latest.id);
    expect(ruleFor(after, "collection_percent", day)?.id).toBe(created.id);
    expect(ruleFor(after, "collection_percent", day)?.rateBp).toBe(600);
    expect(ruleFor(after, "collection_percent", "2026-09-15")?.rateBp).toBe(500);
    expect(ruleState(after, created, today)).toBe("upcoming");
    expect(
      ruleState(
        after,
        after.find((x) => x.id === latest.id)!,
        today,
      ),
    ).toBe(latest.effectiveFrom <= today ? "active" : "upcoming");
    expect(after.filter((r) => ruleState(after, r, today) === "active")).toHaveLength(2);
    expect(
      ruleEndOf(
        after,
        after.find((x) => x.id === latest.id)!,
      ),
    ).toBe(day);
    expect(ruleEndOf(after, created)).toBeNull();
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
    expect(audit!.details).toMatchObject({
      supersededRuleId: latest.id,
      previousRuleId: latest.id,
    });
  });
});
