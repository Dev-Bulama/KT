/**
 * Content-Security-Policy builder. The base policy only allows this origin;
 * `extraOrigins` (https origins of an administrator-approved chatbot widget)
 * are added only on the pages where that widget is allowed to run.
 */
export function buildCsp(extraOrigins: string[] = [], opts: { dev?: boolean } = {}): string {
  const extra = extraOrigins.filter((o) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o));
  const ws = extra.map((o) => o.replace(/^https:/, "wss:"));
  const join = (...parts: string[]) => parts.filter(Boolean).join(" ");
  const x = extra.join(" ");
  return [
    "default-src 'self'",
    join("script-src 'self' 'unsafe-inline'", opts.dev ? "'unsafe-eval'" : "", x),
    join("style-src 'self' 'unsafe-inline'", x),
    join("img-src 'self' data: blob:", x),
    join("font-src 'self' data:", x),
    join("connect-src 'self'", x, ws.join(" ")),
    join("frame-src 'self'", x),
    join("media-src 'self'", x),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
