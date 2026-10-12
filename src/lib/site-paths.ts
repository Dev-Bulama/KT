/**
 * Route groups shared by the proxy (server) and client components.
 * Keep free of server-only imports.
 */
export const PROTECTED_PREFIXES = ["/dashboard", "/requests", "/approvals", "/projects", "/early-warning", "/intelligence", "/reports", "/mdas", "/my-mda", "/feedback", "/complaints", "/knowledge", "/assistant", "/notifications", "/search", "/account", "/admin"];

/** Public information pages where a third-party chatbot widget may run. Sign-in and registration pages are deliberately excluded. */
export const PUBLIC_WIDGET_PATHS = ["/", "/about", "/services", "/contact", "/privacy"];

/** Signed-in areas where a widget never runs, even when enabled for signed-in pages (credentials, MFA and administration). */
const NEVER_WIDGET_PREFIXES = ["/account", "/admin"];

export type ChatbotScope = "public" | "public_and_app";

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((p) => under(pathname, p));
}

export function chatbotAllowedOn(pathname: string, scope: ChatbotScope): boolean {
  if (PUBLIC_WIDGET_PATHS.includes(pathname)) return true;
  if (scope !== "public_and_app") return false;
  if (NEVER_WIDGET_PREFIXES.some((p) => under(pathname, p))) return false;
  return isProtectedPath(pathname);
}
