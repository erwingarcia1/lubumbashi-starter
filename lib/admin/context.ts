import type { AdminSession } from "@/lib/identity/session";

/** WHERE and DEVICE of an admin action for the audit log. */
export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

export function actorOf(session: AdminSession) {
  return { type: "admin" as const, id: session.adminId, role: session.role, label: session.email };
}

export function whereOf(ctx: RequestContext) {
  return ctx.ip ? { ip: ctx.ip } : undefined;
}

export function deviceOf(ctx: RequestContext) {
  return ctx.userAgent ? { userAgent: ctx.userAgent } : undefined;
}
