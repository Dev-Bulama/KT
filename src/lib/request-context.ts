import { headers } from "next/headers";
import { randomUUID } from "node:crypto";

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  correlationId: string;
  origin: string | null;
  host: string | null;
}

/** Returns request metadata when called inside a Next.js request; safe defaults otherwise (scripts, tests). */
export async function getRequestContext(): Promise<RequestContext> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    return {
      ip: (fwd ? fwd.split(",")[0].trim() : h.get("x-real-ip")) || null,
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
      correlationId: h.get("x-correlation-id") || h.get("x-vercel-id") || randomUUID(),
      origin: h.get("origin"),
      host: h.get("x-forwarded-host") || h.get("host"),
    };
  } catch {
    return { ip: null, userAgent: null, correlationId: randomUUID(), origin: null, host: null };
  }
}
