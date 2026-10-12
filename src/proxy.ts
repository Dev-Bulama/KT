import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/csp";
import { chatbotAllowedOn, isProtectedPath } from "@/lib/site-paths";
import { getChatbotRuntime } from "@/modules/site/chatbot";

/**
 * 1. Optimistic gate for authenticated areas: if no session cookie is present,
 *    redirect to sign-in. This is NOT the security boundary — every page,
 *    server action and route handler re-validates the session and permissions.
 * 2. Content-Security-Policy for pages. The base policy allows only this
 *    origin; an administrator-approved chatbot widget's origins are added only
 *    on the pages where the widget may run (never sign-in, account or admin pages).
 */
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-katdict_session" : "katdict_session";
const DEV = process.env.NODE_ENV === "development";

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isProtectedPath(pathname) && !req.cookies.get(COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  if (pathname.startsWith("/api/")) {
    // Route handlers set their own caching; the static API policy comes from next.config.ts.
    if (!pathname.startsWith("/api/site/logo")) res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
  // Pages may contain personal data: never store in shared caches.
  res.headers.set("Cache-Control", "private, no-store");
  const chatbot = await getChatbotRuntime();
  const origins = chatbot.enabled && chatbotAllowedOn(pathname, chatbot.scope) ? chatbot.origins : [];
  res.headers.set("Content-Security-Policy", buildCsp(origins, { dev: DEV }));
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
