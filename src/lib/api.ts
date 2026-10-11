import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/** Same-origin check for state-changing route handlers (CSRF defence in depth; cookies are SameSite=Lax). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) throw new AppError("Cross-origin request rejected.", "CSRF", 403);
}

export function apiError(err: unknown) {
  if (err instanceof AppError) return NextResponse.json({ error: err.message }, { status: err.status });
  logger.error("api.unexpected_error", { error: err as Error });
  return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
}

export function csvResponse(csv: string, filename: string) {
  return new NextResponse(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
}
