import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireActor } from "@/modules/auth/current";
import { authoriseDownload } from "@/modules/files/service";
import { getStorage } from "@/modules/files/storage";

/** Authorised download: redirect to a 60-second presigned URL (S3) or stream (local dev). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireActor();
    const att = await authoriseDownload(actor, id);
    const storage = getStorage();
    const signed = await storage.signedDownloadUrl(att.storageKey, att.originalName, att.contentType, 60);
    if (signed) return NextResponse.redirect(signed, { headers: { "cache-control": "private, no-store" } });
    const bytes = await storage.get(att.storageKey);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "content-type": att.contentType,
        "content-disposition": `attachment; filename="${att.originalName.replace(/"/g, "")}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
