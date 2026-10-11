import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/modules/audit/audit";
import type { Actor } from "@/modules/rbac/actor";
import { assertCan, can } from "@/modules/rbac/authorize";

/** Visibility filter for knowledge documents; applied BEFORE search ranking, AI retrieval and snippets. */
export function knowledgeScope(actor: Actor): Prisma.KnowledgeDocumentWhereInput {
  if (can(actor, "knowledge.manage")) return {};
  if (!can(actor, "knowledge.read")) return { id: { in: [] } };
  const visible: Prisma.KnowledgeDocumentWhereInput[] = [{ visibility: "ALL_USERS" }];
  if (actor.userType !== "MDA_USER") visible.push({ visibility: "KATDICT_ONLY" });
  if (actor.mdaId) visible.push({ visibility: "MDA_SPECIFIC", mdaId: actor.mdaId });
  return { status: "PUBLISHED", OR: visible };
}

export const knowledgeSchema = z.object({
  title: z.string().trim().min(5).max(200),
  summary: z.string().trim().min(10).max(1000),
  body: z.string().trim().min(20).max(50000),
  category: z.enum(["COMPLETED_PROJECT", "REUSABLE_SOLUTION", "TECHNICAL_DOCUMENTATION", "LESSON_LEARNED", "COMMON_INCIDENT", "IMPLEMENTATION_PATTERN", "TRAINING_RESOURCE"]),
  tags: z.string().optional().transform((v) => (v ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20)),
  visibility: z.enum(["KATDICT_ONLY", "ALL_USERS", "MDA_SPECIFIC"]).default("KATDICT_ONLY"),
  mdaId: z.string().cuid().optional().or(z.literal("").transform(() => undefined)),
  projectId: z.string().cuid().optional().or(z.literal("").transform(() => undefined)),
});

/** Full-text search (PostgreSQL websearch_to_tsquery) restricted to authorised documents. */
export async function searchKnowledge(actor: Actor, q: string, category?: string, limit = 20) {
  const scope = knowledgeScope(actor);
  const where: Prisma.KnowledgeDocumentWhereInput = { AND: [scope, category ? { category: category as never } : {}] };
  if (!q.trim()) {
    return prisma.knowledgeDocument.findMany({ where, orderBy: { updatedAt: "desc" }, take: limit, select: { id: true, title: true, summary: true, category: true, tags: true, status: true, visibility: true, updatedAt: true } });
  }
  // Candidate ids by FTS rank, then re-filtered through the authorisation scope.
  const ranked = await prisma.$queryRaw<{ id: string; rank: number }[]>`
    SELECT id, ts_rank(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(body,'')), websearch_to_tsquery('english', ${q})) AS rank
    FROM "KnowledgeDocument"
    WHERE to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(body,'')) @@ websearch_to_tsquery('english', ${q})
       OR title ILIKE ${"%" + q + "%"} OR ${q.toLowerCase()} = ANY(tags)
    ORDER BY rank DESC LIMIT 200`;
  const ids = ranked.map((r) => r.id);
  const docs = await prisma.knowledgeDocument.findMany({ where: { AND: [where, { id: { in: ids } }] }, select: { id: true, title: true, summary: true, category: true, tags: true, status: true, visibility: true, updatedAt: true } });
  const order = new Map(ids.map((id, i) => [id, i]));
  return docs.sort((a, b) => (order.get(a.id)! - order.get(b.id)!)).slice(0, limit);
}

export async function getKnowledgeDoc(actor: Actor, id: string) {
  const doc = await prisma.knowledgeDocument.findFirst({
    where: { AND: [{ id }, knowledgeScope(actor)] },
    include: { author: { select: { name: true } }, approvedBy: { select: { name: true } }, project: { select: { id: true, reference: true } }, attachments: true },
  });
  if (!doc) throw new NotFoundError();
  return doc;
}

export async function saveKnowledgeDoc(actor: Actor, id: string | null, raw: unknown) {
  assertCan(actor, "knowledge.manage");
  const parsed = knowledgeSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Please correct the highlighted fields.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  if (parsed.data.visibility === "MDA_SPECIFIC" && !parsed.data.mdaId) throw new ValidationError("Select the MDA for MDA-specific documents.");
  const data = { ...parsed.data, mdaId: parsed.data.mdaId ?? null, projectId: parsed.data.projectId ?? null };
  const doc = id
    ? await prisma.knowledgeDocument.update({ where: { id }, data: { ...data, status: "DRAFT", approvedById: null } })
    : await prisma.knowledgeDocument.create({ data: { ...data, authorId: actor.id } });
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: id ? "knowledge.updated" : "knowledge.created", entityType: "KnowledgeDocument", entityId: doc.id, after: { title: doc.title, visibility: doc.visibility } });
  return doc;
}

export async function setKnowledgeStatus(actor: Actor, id: string, status: "PUBLISHED" | "ARCHIVED" | "DRAFT") {
  assertCan(actor, "knowledge.manage");
  const doc = await prisma.knowledgeDocument.findUnique({ where: { id } });
  if (!doc) throw new NotFoundError();
  if (status === "PUBLISHED" && doc.authorId === actor.id) throw new ForbiddenError("Another knowledge manager must approve and publish your document.");
  await prisma.knowledgeDocument.update({ where: { id }, data: { status, ...(status === "PUBLISHED" ? { approvedById: actor.id, publishedAt: new Date() } : {}) } });
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: `knowledge.${status.toLowerCase()}`, entityType: "KnowledgeDocument", entityId: id, before: { status: doc.status }, after: { status } });
}
