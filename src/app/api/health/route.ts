import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** Public liveness/readiness probe. Reveals no configuration details. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
