import { and, eq, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { writeAudit } from "@/lib/audit/write";
import { getDb } from "@/lib/db/client";
import { admins } from "@/lib/db/schema";

import type { AdminRole } from "./roles";
import { createSupabaseServerClient } from "./supabase";

export interface AdminSession {
  adminId: string;
  authUserId: string;
  email: string;
  fullName: string;
  role: AdminRole;
}

/**
 * The logged-in Mairie user, or null. Supabase Auth says who; `admin_users` says which role.
 * On first login the auth user is linked to the admin row that carries the same e-mail.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  const db = getDb();
  let [admin] = await db.select().from(admins).where(eq(admins.authUserId, user.id));
  if (!admin) {
    const email = user.email.toLowerCase();
    const [byEmail] = await db
      .select()
      .from(admins)
      .where(and(eq(sql`lower(${admins.email})`, email), isNull(admins.authUserId)));
    if (!byEmail) return null;
    await db.transaction(async (tx) => {
      await tx
        .update(admins)
        .set({ authUserId: user.id, updatedAt: new Date() })
        .where(eq(admins.id, byEmail.id));
      await writeAudit(tx, {
        actor: { type: "admin", id: byEmail.id, role: byEmail.role, label: byEmail.email },
        action: "admin.linked",
        object: { type: "admin_user", id: byEmail.email },
        details: { authUserId: user.id },
      });
    });
    admin = { ...byEmail, authUserId: user.id };
  }
  if (!admin.active || admin.disabledAt) return null;
  return {
    adminId: admin.id,
    authUserId: user.id,
    email: admin.email,
    fullName: admin.fullName,
    role: admin.role,
  };
}

/** For pages and server actions: redirects to the login page, or to the forbidden page. */
export async function requireAdmin(allowed?: readonly AdminRole[]): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (allowed && !allowed.includes(session.role)) redirect("/admin/interdit");
  return session;
}
