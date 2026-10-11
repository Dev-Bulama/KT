import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/modules/audit/audit";
import { notify, usersWithPermission } from "@/modules/notifications/service";
import type { Actor } from "@/modules/rbac/actor";
import { assertCan, can } from "@/modules/rbac/authorize";
import { complaintScope, projectScope, requestScope } from "@/modules/rbac/scope";

export const feedbackSchema = z.object({
  projectId: z.string().cuid(),
  rating: z.coerce.number().int().min(1).max(5),
  comments: z.string().trim().max(3000).optional(),
});

export async function submitFeedback(actor: Actor, raw: unknown) {
  assertCan(actor, "feedback.submit");
  const parsed = feedbackSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Provide a rating between 1 and 5.");
  const p = await prisma.project.findFirst({ where: { AND: [{ id: parsed.data.projectId }, projectScope(actor)] } });
  if (!p || p.mdaId !== actor.mdaId) throw new NotFoundError();
  if (!["ACCEPTED", "CLOSED"].includes(p.status)) throw new AppError("Feedback can be given once the project has been accepted.");
  await prisma.$transaction(async (tx) => {
    const fb = await tx.feedback.upsert({
      where: { projectId_userId: { projectId: p.id, userId: actor.id } },
      create: { projectId: p.id, mdaId: p.mdaId, userId: actor.id, rating: parsed.data.rating, comments: parsed.data.comments ?? null },
      update: { rating: parsed.data.rating, comments: parsed.data.comments ?? null },
    });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "feedback.submitted", entityType: "Feedback", entityId: fb.id, after: { projectId: p.id, rating: fb.rating } });
    await notify(tx, { userIds: await usersWithPermission(tx, "feedback.read.all"), type: "feedback.received", title: `Feedback received: ${p.reference}`, body: `Rating ${fb.rating}/5${fb.comments ? `: ${fb.comments.slice(0, 300)}` : ""}`, link: `/projects/${p.id}`, email: false });
  });
}

export async function listFeedback(actor: Actor) {
  if (can(actor, "feedback.read.all")) {
    return prisma.feedback.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { mda: { select: { name: true } }, project: { select: { id: true, reference: true, title: true } }, user: { select: { name: true } } } });
  }
  if (!actor.mdaId) return [];
  return prisma.feedback.findMany({ where: { mdaId: actor.mdaId }, orderBy: { createdAt: "desc" }, take: 200, include: { mda: { select: { name: true } }, project: { select: { id: true, reference: true, title: true } }, user: { select: { name: true } } } });
}

// ---------------------------------------------------------------------------
// Complaints
// ---------------------------------------------------------------------------

export const complaintSchema = z.object({
  subject: z.string().trim().min(5).max(200),
  description: z.string().trim().min(20).max(5000),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  projectId: z.string().cuid().optional().or(z.literal("").transform(() => undefined)),
  requestId: z.string().cuid().optional().or(z.literal("").transform(() => undefined)),
});

async function nextComplaintRef() {
  const year = new Date().getFullYear();
  const rows = await prisma.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key","value") VALUES (${`CMP-${year}`}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1 RETURNING "value"`;
  return `KATDICT-CMP-${year}-${String(Number(rows[0].value)).padStart(5, "0")}`;
}

export async function submitComplaint(actor: Actor, raw: unknown) {
  assertCan(actor, "complaint.submit");
  if (!actor.mdaId) throw new ForbiddenError();
  const parsed = complaintSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Please correct the highlighted fields.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const c = parsed.data;
  if (c.projectId && !(await prisma.project.findFirst({ where: { AND: [{ id: c.projectId, mdaId: actor.mdaId }, projectScope(actor)] } }))) throw new NotFoundError();
  if (c.requestId && !(await prisma.serviceRequest.findFirst({ where: { AND: [{ id: c.requestId, mdaId: actor.mdaId }, requestScope(actor)] } }))) throw new NotFoundError();
  const reference = await nextComplaintRef();
  await prisma.$transaction(async (tx) => {
    const rec = await tx.complaint.create({ data: { ...c, reference, mdaId: actor.mdaId!, raisedById: actor.id } });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "complaint.submitted", entityType: "Complaint", entityId: rec.id, after: { reference, subject: c.subject } });
    await notify(tx, { userIds: await usersWithPermission(tx, "complaint.manage"), type: "complaint.received", title: `Complaint ${reference}`, body: `${actor.mdaName}: ${c.subject}`, link: `/complaints/${rec.id}` });
  });
  return reference;
}

export async function listComplaints(actor: Actor, status?: string) {
  return prisma.complaint.findMany({
    where: { AND: [complaintScope(actor), status ? { status: status as never } : {}] },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: { mda: { select: { name: true, abbreviation: true } }, raisedBy: { select: { name: true } }, assignedTo: { select: { name: true } }, project: { select: { reference: true } } },
  });
}

export async function getComplaint(actor: Actor, id: string) {
  const c = await prisma.complaint.findFirst({
    where: { AND: [{ id }, complaintScope(actor)] },
    include: { mda: { select: { name: true } }, raisedBy: { select: { name: true } }, assignedTo: { select: { id: true, name: true } }, project: { select: { id: true, reference: true, title: true } }, request: { select: { id: true, reference: true } } },
  });
  if (!c) throw new NotFoundError();
  return c;
}

export async function updateComplaint(actor: Actor, id: string, action: "REVIEW" | "ESCALATE" | "RESOLVE" | "CLOSE", note: string, assignedToId?: string) {
  assertCan(actor, "complaint.manage");
  if (!note?.trim()) throw new ValidationError("A note is required.");
  const c = await prisma.complaint.findUnique({ where: { id } });
  if (!c) throw new NotFoundError();
  const allowed: Record<string, string[]> = { REVIEW: ["OPEN", "ESCALATED"], ESCALATE: ["OPEN", "UNDER_REVIEW"], RESOLVE: ["OPEN", "UNDER_REVIEW", "ESCALATED"], CLOSE: ["RESOLVED"] };
  if (!allowed[action].includes(c.status)) throw new AppError("This action is not allowed in the complaint's current status.");
  const to = { REVIEW: "UNDER_REVIEW", ESCALATE: "ESCALATED", RESOLVE: "RESOLVED", CLOSE: "CLOSED" }[action] as "UNDER_REVIEW" | "ESCALATED" | "RESOLVED" | "CLOSED";
  await prisma.$transaction(async (tx) => {
    await tx.complaint.update({
      where: { id },
      data: {
        status: to, ...(assignedToId ? { assignedToId } : action === "REVIEW" ? { assignedToId: actor.id } : {}),
        ...(to === "ESCALATED" ? { escalatedAt: new Date() } : {}), ...(to === "RESOLVED" ? { resolvedAt: new Date(), resolution: note } : {}),
      },
    });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: `complaint.${action.toLowerCase()}`, entityType: "Complaint", entityId: id, before: { status: c.status }, after: { status: to }, reason: note });
    if (to === "ESCALATED") {
      await notify(tx, { userIds: await usersWithPermission(tx, "analytics.executive"), type: "complaint.escalated", title: `Complaint escalated: ${c.reference}`, body: `${c.subject}\n\n${note}`, link: `/complaints/${id}` });
    }
    await notify(tx, { userIds: [c.raisedById], type: "complaint.updated", title: `Complaint ${c.reference}: ${to.replace("_", " ").toLowerCase()}`, body: note, link: `/complaints/${id}` });
  });
}
