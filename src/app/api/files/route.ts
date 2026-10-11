import { NextResponse } from "next/server";
import { apiError, assertSameOrigin } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireActor } from "@/modules/auth/current";
import { uploadFile } from "@/modules/files/service";

const CATEGORIES = ["REQUEST_DOCUMENT", "TECHNICAL_SPECIFICATION", "PROPOSAL", "ARCHITECTURE", "TEST_EVIDENCE", "COMPLETION_REPORT", "USER_MANUAL", "TRAINING_MATERIAL", "HANDOVER", "DELIVERABLE", "EVIDENCE", "KNOWLEDGE", "OTHER"] as const;

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const actor = await requireActor();
    await enforceRateLimit(`upload:${actor.id}`, 60, 3600, "Upload limit reached. Try again later.");
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) throw new ValidationError("No file provided.");
    const max = Number(process.env.FILE_UPLOAD_MAX_SIZE ?? 4 * 1024 * 1024);
    if (file.size > max) throw new ValidationError(`Files must be at most ${(max / 1024 / 1024).toFixed(1)} MB.`);
    const s = (k: string) => (typeof fd.get(k) === "string" && fd.get(k) ? String(fd.get(k)) : undefined);
    const category = (CATEGORIES as readonly string[]).includes(s("category") ?? "") ? (s("category") as (typeof CATEGORIES)[number]) : "OTHER";
    const att = await uploadFile(actor, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, {
      requestId: s("requestId"), projectId: s("projectId"), deliverableId: s("deliverableId"), knowledgeDocumentId: s("knowledgeDocumentId"),
      category, visibility: s("visibility") === "INTERNAL" ? "INTERNAL" : "MDA_VISIBLE",
    });
    return NextResponse.json({ id: att.id, originalName: att.originalName, sizeBytes: att.sizeBytes, scanStatus: att.scanStatus });
  } catch (e) {
    return apiError(e);
  }
}
