import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { runEscalations } from "@/modules/quality/escalations";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await runEscalations()) });
}
