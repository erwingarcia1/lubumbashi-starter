import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { AGENT_COOKIE, verifyAgentToken } from "@/lib/identity/agent-session";

/**
 * Refreshes the Supabase Auth session on every /admin request and keeps anonymous visitors on
 * the login page. Authorization by role happens in requireAdmin(), not here.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { pathname } = request.nextUrl;

  // Agent PWA: signed cookie checked here; the device's revocation status is checked by the pages.
  if (pathname.startsWith("/agent")) {
    const isLogin = pathname === "/agent/login";
    const payload = process.env.AGENT_SESSION_SECRET
      ? await verifyAgentToken(request.cookies.get(AGENT_COOKIE)?.value)
      : null;
    if (!payload && !isLogin) {
      const to = request.nextUrl.clone();
      to.pathname = "/agent/login";
      to.search = "";
      return NextResponse.redirect(to);
    }
    if (payload && isLogin) {
      const to = request.nextUrl.clone();
      to.pathname = "/agent";
      to.search = "";
      return NextResponse.redirect(to);
    }
    return response;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLogin = pathname === "/admin/login";
  if (!user && !isLogin) {
    const to = request.nextUrl.clone();
    to.pathname = "/admin/login";
    to.search = "";
    if (pathname !== "/admin") to.searchParams.set("next", pathname);
    return NextResponse.redirect(to);
  }
  if (user && isLogin) {
    const to = request.nextUrl.clone();
    to.pathname = "/admin";
    to.search = "";
    return NextResponse.redirect(to);
  }
  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/agent/:path*"],
};
