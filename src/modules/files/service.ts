import { randomUUID } from "node:crypto";
import type { AttachmentCategory, Visibility } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { audit } from "@/modules/audit/audit";
import type { Actor } from "@/modules/rbac/actor";
import { can } from "@/modules/rbac/authorize";
import { canSeeInternal, projectScope, requestScope } from "@/modules/rbac/scope";
import { getSetting } from "@/modules/settings/service";
import { canWorkOnProject } from "@/modules/projects/access";
import { safeFileName, sniffFileType } from "./sniff";
import { getStorage } from "./storage";

export interface UploadTarget {
  requestId?: string;
  projectId?: string;
  deliverableId?: string;
  knowledgeDocumentId?: string;
  category: AttachmentCategory;
  visibility: Visibility;
}

/** Authorises the upload target. Returns the normalised target (ownership derived server-side). */
async function authoriseUpload(actor: Actor, t: UploadTarget): Promise<UploadTarget> {
  if (actor.userType === "OVERSIGHT") throw new ForbiddenError("Oversight accounts are read-only.");
  if (t.requestId) {
    const req = await prisma.serviceRequest.findFirst({ where: { AND: [{ id: t.requestId }, requestScope(actor)] } });
    if (!req) throw new NotFoundError();
    if (actor.userType === "MDA_USER") {
      if (req.mdaId !== actor.mdaId) throw new ForbiddenError();
      const editable = (req.status === "DRAFT" && req.createdById === actor.id) || req.status === "NEEDS_INFORMATION";
      if (!editable) throw new AppError("Documents can only be added to drafts or when KATDICT has requested information.");
      return { requestId: req.id, category: t.category, visibility: "MDA_VISIBLE" };
    }
    if (actor.userType !== "KATDICT_STAFF") throw new ForbiddenError();
    return { requestId: req.id, category: t.category, visibility: t.visibility };
  }
  if (t.projectId || t.deliverableId) {
    let projectId = t.projectId;
    if (t.deliverableId) {
      const d = await prisma.projectDeliverable.findUnique({ where: { id: t.deliverableId } });
      if (!d) throw new NotFoundError();
      projectId = d.projectId;
    }
    const p = await prisma.project.findFirst({ where: { AND: [{ id: projectId! }, projectScope(actor)] } });
    if (!p) throw new NotFoundError();
    if (["CLOSED", "CANCELLED"].includes(p.status)) throw new AppError("The project is closed.");
    if (actor.userType === "MDA_USER") {
      if (p.mdaId !== actor.mdaId || !can(actor, "project.comment.external")) throw new ForbiddenError();
      return { projectId: p.id, category: "OTHER", visibility: "MDA_VISIBLE" };
    }
    if (!(await canWorkOnProject(prisma, actor, p))) throw new ForbiddenError("Only the assigned team can upload project files.");
    return { projectId: p.id, deliverableId: t.deliverableId, category: t.deliverableId ? "DELIVERABLE" : t.category, visibility: t.visibility };
  }
  if (t.knowledgeDocumentId) {
    if (!can(actor, "knowledge.manage")) throw new ForbiddenError();
    return { knowledgeDocumentId: t.knowledgeDocumentId, category: "KNOWLEDGE", visibility: t.visibility };
  }
  throw new ValidationError("Upload target is required.");
}

/**
 * Hook for malware scanning. If MALWARE_SCAN_WEBHOOK_URL is configured the file
 * hash and bytes are posted to the scanner and suspicious files are QUARANTINED
 * (never downloadable until reviewed). Without a scanner, files are NOT_SCANNED.
 */
async function scan(bytes: Uint8Array, hash: string): Promise<"CLEAN" | "QUARANTINED" | "NOT_SCANNED"> {
  const url = process.env.MALWARE_SCAN_WEBHOOK_URL;
  if (!url) return "NOT_SCANNED";
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/octet-stream", "x-sha256": hash }, body: Buffer.from(bytes), signal: AbortSignal.timeout(15000) });
    const body = (await res.json()) as { verdict?: string };
    return body.verdict === "clean" ? "CLEAN" : "QUARANTINED";
  } catch (err) {
    logger.warn("files.scan_failed", { error: (err as Error).message });
    return "QUARANTINED"; // fail closed
  }
}

export async function uploadFile(actor: Actor, file: { name: string; bytes: Uint8Array }, target: UploadTarget) {
  const max = Number(process.env.FILE_UPLOAD_MAX_SIZE ?? 4 * 1024 * 1024);
  if (file.bytes.length === 0) throw new ValidationError("The file is empty.");
  if (file.bytes.length > max) throw new ValidationError(`Files must be at most ${(max / 1024 / 1024).toFixed(1)} MB.`);
  const normalised = await authoriseUpload(actor, target);
  const sniffed = sniffFileType(file.bytes, file.name);
  const allowed = await getSetting("files.allowedTypes");
  if (!sniffed || !allowed.includes(sniffed.ext)) throw new ValidationError(`This file type is not permitted. Allowed: ${allowed.join(", ")}.`);
  const hash = sha256(Buffer.from(file.bytes));
  const scanStatus = await scan(file.bytes, hash);
  const key = `${new Date().getFullYear()}/${randomUUID()}.${sniffed.ext}`; // randomised, unguessable key
  await getStorage().put(key, file.bytes, sniffed.mime);
  const name = safeFileName(file.name);
  const att = await prisma.attachment.create({
    data: {
      storageKey: key, originalName: name, sizeBytes: file.bytes.length, contentType: sniffed.mime, sha256: hash,
      category: normalised.category, visibility: normalised.visibility, scanStatus, uploadedById: actor.id,
      requestId: normalised.requestId ?? null, projectId: normalised.projectId ?? null, deliverableId: normalised.deliverableId ?? null,
      knowledgeDocumentId: normalised.knowledgeDocumentId ?? null,
    },
  });
  await audit(null, {
    actorId: actor.id, actorEmail: actor.email, action: "file.uploaded", entityType: "Attachment", entityId: att.id,
    after: { name, sizeBytes: att.sizeBytes, contentType: att.contentType, sha256: hash, requestId: att.requestId, projectId: att.projectId, deliverableId: att.deliverableId, scanStatus },
  });
  return att;
}

/** Download authorisation: re-checks the parent record's scope and internal visibility on every request. */
export async function authoriseDownload(actor: Actor, attachmentId: string) {
  const att = await prisma.attachment.findUnique({ where: { id: attachmentId }, include: { deliverable: true } });
  if (!att) throw new NotFoundError();
  if (att.visibility === "INTERNAL" && !canSeeInternal(actor)) throw new NotFoundError();
  if (att.scanStatus === "QUARANTINED") throw new AppError("This file is quarantined pending security review.");
  const projectId = att.projectId ?? att.deliverable?.projectId;
  if (att.requestId) {
    const ok = await prisma.serviceRequest.findFirst({ where: { AND: [{ id: att.requestId }, requestScope(actor)] }, select: { id: true } });
    if (!ok) throw new NotFoundError();
  } else if (projectId) {
    const ok = await prisma.project.findFirst({ where: { AND: [{ id: projectId }, projectScope(actor)] }, select: { id: true } });
    if (!ok) throw new NotFoundError();
  } else if (att.knowledgeDocumentId) {
    if (!can(actor, "knowledge.read")) throw new NotFoundError();
    const doc = await prisma.knowledgeDocument.findUnique({ where: { id: att.knowledgeDocumentId } });
    if (!doc) throw new NotFoundError();
    const visible = can(actor, "knowledge.manage") || (doc.status === "PUBLISHED" && (doc.visibility === "ALL_USERS" || (doc.visibility === "MDA_SPECIFIC" && doc.mdaId === actor.mdaId) || (doc.visibility === "KATDICT_ONLY" && actor.userType !== "MDA_USER")));
    if (!visible) throw new NotFoundError();
  } else {
    throw new NotFoundError();
  }
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "file.downloaded", entityType: "Attachment", entityId: att.id });
  return att;
}
