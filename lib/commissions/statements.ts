import { and, asc, eq } from "drizzle-orm";

import { actorOf, deviceOf, whereOf, type RequestContext } from "@/lib/admin/context";
import { AdminError } from "@/lib/admin/errors";
import { writeAudit } from "@/lib/audit/write";
import type { Db, Tx } from "@/lib/db/client";
import { agents, commissionLines, commissionStatements } from "@/lib/db/schema";
import { canManageCommissions } from "@/lib/identity/roles";
import type { AdminSession } from "@/lib/identity/session";

import { computeStatement, type StatementTotals } from "./compute";
import { isPeriod } from "./period";

export type StatementRow = typeof commissionStatements.$inferSelect;
export type StatementStatus = StatementRow["status"];

/** Replaces the lines of a draft with a fresh computation and returns the new totals. */
async function refreshLines(
  tx: Tx,
  statement: StatementRow,
  now: Date,
): Promise<{ totals: StatementTotals; lineCount: number }> {
  const computed = await computeStatement(tx, statement.agentId, statement.period, now);
  await tx.delete(commissionLines).where(eq(commissionLines.statementId, statement.id));
  if (computed.lines.length)
    await tx
      .insert(commissionLines)
      .values(computed.lines.map((l) => ({ statementId: statement.id, ...l })));
  return { totals: computed.totals, lineCount: computed.lines.length };
}

/**
 * Creates or refreshes the agent's draft for a month: old draft lines go, the new ones and the
 * totals come in. An approved or paid statement is frozen and comes back untouched.
 */
export async function upsertDraft(
  db: Db,
  agentId: string,
  period: string,
  now = new Date(),
): Promise<StatementRow> {
  if (!isPeriod(period)) throw new AdminError("invalid_input", `period ${period}`);
  return db.transaction(async (tx) => {
    await tx.insert(commissionStatements).values({ agentId, period }).onConflictDoNothing();
    const [statement] = await tx
      .select()
      .from(commissionStatements)
      .where(
        and(eq(commissionStatements.agentId, agentId), eq(commissionStatements.period, period)),
      )
      .for("update");
    if (!statement) throw new AdminError("not_found", `${agentId}/${period}`);
    if (statement.status !== "draft") return statement;
    const { totals } = await refreshLines(tx, statement, now);
    const [updated] = await tx
      .update(commissionStatements)
      .set({ ...totals, computedAt: now, updatedAt: now })
      .where(eq(commissionStatements.id, statement.id))
      .returning();
    return updated!;
  });
}

async function matriculeOf(tx: Tx, agentId: string): Promise<string> {
  const [a] = await tx
    .select({ matricule: agents.matricule })
    .from(agents)
    .where(eq(agents.id, agentId));
  return a?.matricule ?? agentId;
}

/**
 * Finances or the Administrateur approve a draft: its lines are recomputed one last time in the
 * same transaction, then frozen with the statement. Audited with WHO/WHERE/DEVICE.
 */
export async function approveStatement(
  db: Db,
  session: AdminSession,
  statementId: string,
  ctx: RequestContext = {},
  now = new Date(),
): Promise<StatementRow> {
  if (!canManageCommissions(session.role)) throw new AdminError("forbidden");
  return db.transaction(async (tx) => {
    const [statement] = await tx
      .select()
      .from(commissionStatements)
      .where(eq(commissionStatements.id, statementId))
      .for("update");
    if (!statement) throw new AdminError("not_found", statementId);
    if (statement.status !== "draft")
      throw new AdminError("invalid_state", `statement is ${statement.status}`);
    const { totals, lineCount } = await refreshLines(tx, statement, now);
    const [updated] = await tx
      .update(commissionStatements)
      .set({
        ...totals,
        computedAt: now,
        status: "approved",
        approvedAt: now,
        approvedByAdminId: session.adminId,
        updatedAt: now,
      })
      .where(eq(commissionStatements.id, statement.id))
      .returning();
    const matricule = await matriculeOf(tx, statement.agentId);
    await writeAudit(tx, {
      actor: actorOf(session),
      action: "commission_statement.approved",
      object: { type: "commission_statement", id: `${matricule}/${statement.period}` },
      details: { statementId: statement.id, agentId: statement.agentId, lineCount, ...totals },
      where: whereOf(ctx),
      device: deviceOf(ctx),
    });
    return updated!;
  });
}

/** Marks an approved statement paid with the payout reference (bank or mobile-money transfer). */
export async function markPaid(
  db: Db,
  session: AdminSession,
  statementId: string,
  input: { reference: string },
  ctx: RequestContext = {},
  now = new Date(),
): Promise<StatementRow> {
  if (!canManageCommissions(session.role)) throw new AdminError("forbidden");
  const reference = (input.reference ?? "").trim();
  if (reference.length < 3 || reference.length > 80)
    throw new AdminError("invalid_input", "payout reference required");
  return db.transaction(async (tx) => {
    const [statement] = await tx
      .select()
      .from(commissionStatements)
      .where(eq(commissionStatements.id, statementId))
      .for("update");
    if (!statement) throw new AdminError("not_found", statementId);
    if (statement.status !== "approved")
      throw new AdminError("invalid_state", `statement is ${statement.status}`);
    const [updated] = await tx
      .update(commissionStatements)
      .set({
        status: "paid",
        paidAt: now,
        paidByAdminId: session.adminId,
        paidReference: reference,
        updatedAt: now,
      })
      .where(eq(commissionStatements.id, statement.id))
      .returning();
    const matricule = await matriculeOf(tx, statement.agentId);
    await writeAudit(tx, {
      actor: actorOf(session),
      action: "commission_statement.paid",
      object: { type: "commission_statement", id: `${matricule}/${statement.period}` },
      details: {
        statementId: statement.id,
        agentId: statement.agentId,
        totalFc: statement.totalFc,
        reference,
      },
      where: whereOf(ctx),
      device: deviceOf(ctx),
    });
    return updated!;
  });
}

export interface AdminStatementRow extends StatementTotals {
  agentId: string;
  matricule: string;
  fullName: string;
  agentStatus: "active" | "suspended";
  /** Null when nothing is stored yet: the figures are computed on the fly. */
  statementId: string | null;
  status: StatementStatus;
  stored: boolean;
  computedAt: Date;
  approvedAt: Date | null;
  paidAt: Date | null;
  paidReference: string | null;
}

/**
 * The month's table for the dashboard and the report: every active agent (plus any agent that
 * has a statement for the month); stored statements as stored, the others computed live.
 */
export async function listStatements(
  db: Db,
  period: string,
  now = new Date(),
): Promise<AdminStatementRow[]> {
  if (!isPeriod(period)) throw new AdminError("invalid_input", `period ${period}`);
  const people = await db
    .select({
      id: agents.id,
      matricule: agents.matricule,
      fullName: agents.fullName,
      status: agents.status,
    })
    .from(agents)
    .orderBy(asc(agents.matricule));
  const stored = await db
    .select()
    .from(commissionStatements)
    .where(eq(commissionStatements.period, period));
  const rows: AdminStatementRow[] = [];
  for (const a of people) {
    const s = stored.find((x) => x.agentId === a.id);
    if (!s && a.status !== "active") continue;
    if (s) {
      rows.push({
        agentId: a.id,
        matricule: a.matricule,
        fullName: a.fullName,
        agentStatus: a.status,
        statementId: s.id,
        status: s.status,
        stored: true,
        computedAt: s.computedAt,
        approvedAt: s.approvedAt,
        paidAt: s.paidAt,
        paidReference: s.paidReference,
        collectionsCount: s.collectionsCount,
        collectedFc: s.collectedFc,
        collectionCommissionFc: s.collectionCommissionFc,
        registrationsCount: s.registrationsCount,
        registrationCommissionFc: s.registrationCommissionFc,
        totalFc: s.totalFc,
      });
      continue;
    }
    const c = await computeStatement(db, a.id, period, now);
    rows.push({
      agentId: a.id,
      matricule: a.matricule,
      fullName: a.fullName,
      agentStatus: a.status,
      statementId: null,
      status: "draft",
      stored: false,
      computedAt: c.computedAt,
      approvedAt: null,
      paidAt: null,
      paidReference: null,
      ...c.totals,
    });
  }
  return rows;
}
