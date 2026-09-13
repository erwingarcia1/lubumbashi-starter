import { asc, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { writeAudit } from "@/lib/audit/write";
import type { Db } from "@/lib/db/client";
import { admins } from "@/lib/db/schema";
import { ADMIN_ROLES, type AdminRole } from "@/lib/identity/roles";
import type { AdminSession } from "@/lib/identity/session";
import { supabaseAdmin } from "@/lib/identity/supabase-admin";

import { actorOf, deviceOf, whereOf, type RequestContext } from "./context";
import { AdminError } from "./errors";

export const createAdminUserInput = z.object({
  email: z.email().transform((e) => e.trim().toLowerCase()),
  fullName: z.string().trim().min(3).max(120),
  role: z.enum(ADMIN_ROLES),
});
export type CreateAdminUserInput = z.infer<typeof createAdminUserInput>;

export interface AdminUserRow {
  id: string;
  email: string;
  fullName: string;
  role: AdminRole;
  active: boolean;
  linked: boolean;
  createdAt: Date;
}

export async function listAdminUsers(db: Db): Promise<AdminUserRow[]> {
  const rows = await db.select().from(admins).orderBy(asc(admins.email));
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    fullName: r.fullName,
    role: r.role,
    active: r.active && !r.disabledAt,
    linked: !!r.authUserId,
    createdAt: r.createdAt,
  }));
}

/** A readable one-time password: 14 characters, no ambiguous glyphs. */
export function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("") + "!";
}

/**
 * Creates the Supabase Auth login and the `admin_users` row. The temporary password is returned
 * once to the Administrateur, who hands it over; it is never stored or logged by the platform.
 */
export async function createAdminUser(
  db: Db,
  session: AdminSession,
  raw: CreateAdminUserInput,
  ctx: RequestContext = {},
): Promise<{ id: string; email: string; temporaryPassword: string }> {
  if (session.role !== "administrateur") throw new AdminError("forbidden");
  const input = createAdminUserInput.parse(raw);
  const [existing] = await db.select().from(admins).where(eq(admins.email, input.email));
  if (existing?.authUserId) throw new AdminError("invalid_state", "user already exists");
  const auth = supabaseAdmin();
  const password = temporaryPassword();
  const { data, error } = await auth.auth.admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new AdminError("invalid_state", error?.message ?? "auth user");
  const id = await db.transaction(async (tx) => {
    let adminId: string;
    if (existing) {
      await tx
        .update(admins)
        .set({
          authUserId: data.user.id,
          fullName: input.fullName,
          role: input.role,
          active: true,
          disabledAt: null,
          updatedAt: new Date(),
        })
        .where(eq(admins.id, existing.id));
      adminId = existing.id;
    } else {
      const [row] = await tx
        .insert(admins)
        .values({
          authUserId: data.user.id,
          email: input.email,
          fullName: input.fullName,
          role: input.role,
        })
        .returning({ id: admins.id });
      adminId = row!.id;
    }
    await writeAudit(tx, {
      actor: actorOf(session),
      action: "admin_user.created",
      object: { type: "admin_user", id: input.email },
      details: { fullName: input.fullName, role: input.role },
      where: whereOf(ctx),
      device: deviceOf(ctx),
    });
    return adminId;
  });
  return { id, email: input.email, temporaryPassword: password };
}

export async function setAdminRole(
  db: Db,
  session: AdminSession,
  input: { adminId: string; role: AdminRole },
  ctx: RequestContext = {},
): Promise<void> {
  if (session.role !== "administrateur") throw new AdminError("forbidden");
  const role = z.enum(ADMIN_ROLES).parse(input.role);
  if (input.adminId === session.adminId && role !== "administrateur")
    throw new AdminError("invalid_state", "cannot demote yourself");
  const [row] = await db.select().from(admins).where(eq(admins.id, input.adminId));
  if (!row) throw new AdminError("not_found", input.adminId);
  await db.transaction(async (tx) => {
    await tx.update(admins).set({ role, updatedAt: new Date() }).where(eq(admins.id, row.id));
    await writeAudit(tx, {
      actor: actorOf(session),
      action: "admin_user.role_changed",
      object: { type: "admin_user", id: row.email },
      details: { from: row.role, to: role },
      where: whereOf(ctx),
      device: deviceOf(ctx),
    });
  });
}

/** Disabling also bans the Supabase login, so an open session ends at its next request. */
export async function setAdminActive(
  db: Db,
  session: AdminSession,
  input: { adminId: string; active: boolean },
  ctx: RequestContext = {},
): Promise<void> {
  if (session.role !== "administrateur") throw new AdminError("forbidden");
  if (input.adminId === session.adminId)
    throw new AdminError("invalid_state", "cannot disable yourself");
  const [row] = await db.select().from(admins).where(eq(admins.id, input.adminId));
  if (!row) throw new AdminError("not_found", input.adminId);
  if (row.authUserId) {
    const { error } = await supabaseAdmin().auth.admin.updateUserById(row.authUserId, {
      ban_duration: input.active ? "none" : "876000h",
    });
    if (error) throw new AdminError("invalid_state", error.message);
  }
  await db.transaction(async (tx) => {
    await tx
      .update(admins)
      .set({
        active: input.active,
        disabledAt: input.active ? null : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(admins.id, row.id));
    await writeAudit(tx, {
      actor: actorOf(session),
      action: input.active ? "admin_user.enabled" : "admin_user.disabled",
      object: { type: "admin_user", id: row.email },
      details: {},
      where: whereOf(ctx),
      device: deviceOf(ctx),
    });
  });
}
