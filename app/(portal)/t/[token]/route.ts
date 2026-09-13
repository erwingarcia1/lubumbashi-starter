import { NextResponse } from "next/server";

import { getDb } from "@/lib/db/client";
import { resolvePortalLink } from "@/lib/portal/links";
import { PORTAL_COOKIE, portalCookieOptions } from "@/lib/portal/session";

/**
 * The SMS link. A valid token opens a 12 h portal session (cookie) and lands on /p; anything
 * else lands on the "lien expiré" screen. The token never appears in a page URL again.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const taxpayer = await resolvePortalLink(getDb(), token);
  const url = new URL(request.url);
  if (!taxpayer) return NextResponse.redirect(new URL("/p/expire", url));
  const res = NextResponse.redirect(new URL("/p", url));
  res.cookies.set(PORTAL_COOKIE, token, portalCookieOptions());
  return res;
}
