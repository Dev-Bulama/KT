import { NextResponse } from "next/server";
import { processOutbox } from "@/modules/notifications/service";
import { safeEqual } from "@/lib/crypto";

/** Vercel Cron (or any scheduler) calls this with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = await processOutbox(100);
  return NextResponse.json({ ok: true, ...r });
}
