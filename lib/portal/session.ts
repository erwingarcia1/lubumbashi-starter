import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getDb } from "@/lib/db/client";

import { resolvePortalLink } from "./links";

export const PORTAL_COOKIE = "portal_session";
export const PORTAL_SESSION_HOURS = 12;

export function portalCookieOptions(appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "") {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: appUrl.startsWith("https://"),
    path: "/",
    maxAge: PORTAL_SESSION_HOURS * 3600,
  };
}

export type PortalTaxpayer = NonNullable<Awaited<ReturnType<typeof resolvePortalLink>>>;

/**
 * The taxpayer behind the portal cookie, or null. The cookie carries the signed-link token
 * itself, so a link revoked or expired server-side ends the session at once (no passwords,
 * CLAUDE.md: link-based access).
 */
export async function getPortalTaxpayer(): Promise<PortalTaxpayer | null> {
  const store = await cookies();
  const token = store.get(PORTAL_COOKIE)?.value;
  if (!token) return null;
  return resolvePortalLink(getDb(), token);
}

export async function requirePortalTaxpayer(): Promise<PortalTaxpayer> {
  const taxpayer = await getPortalTaxpayer();
  if (!taxpayer) redirect("/p/expire");
  return taxpayer;
}
