import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate for authenticated areas: if no session cookie is present,
 * redirect to sign-in. This is NOT the security boundary — every page,
 * server action and route handler re-validates the session and permissions.
 */
const PROTECTED = ["/dashboard", "/requests", "/approvals", "/projects", "/early-warning", "/intelligence", "/reports", "/mdas", "/my-mda", "/feedback", "/complaints", "/knowledge", "/assistant", "/notifications", "/search", "/account", "/admin"];
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-katdict_session" : "katdict_session";

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`)) && !req.cookies.get(COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  // Authenticated pages must not be stored by shared caches.
  if (!pathname.startsWith("/_next")) res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
