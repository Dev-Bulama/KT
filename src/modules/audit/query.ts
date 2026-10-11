import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type { Actor } from "@/modules/rbac/actor";
import { assertCan, can } from "@/modules/rbac/authorize";
import { projectScope, requestScope } from "@/modules/rbac/scope";

export interface AuditFilters {
  q?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  page?: number;
}

export async function searchAudit(actor: Actor, f: AuditFilters) {
  assertCan(actor, "audit.read");
  const page = Math.max(1, f.page ?? 1);
  const pageSize = 50;
  const where: Prisma.AuditEventWhereInput = {
    AND: [
      f.action ? { action: { startsWith: f.action } } : {},
      f.entityType ? { entityType: f.entityType } : {},
      f.entityId ? { entityId: f.entityId } : {},
      f.actorId ? { actorId: f.actorId } : {},
      f.q ? { OR: [{ actorEmail: { contains: f.q, mode: "insensitive" } }, { action: { contains: f.q, mode: "insensitive" } }, { entityId: f.q }] } : {},
      f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {},
    ],
  };
  const [items, total] = await Promise.all([
    prisma.auditEvent.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.auditEvent.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

/**
 * Digital Decision Trail for a request and its project: the ordered sequence
 * of significant decisions with actor, timestamp, previous/new state and reason.
 * Visible to anyone who can see the record; MDA users see KATDICT actors as "KATDICT".
 */
export async function decisionTrail(actor: Actor, opts: { requestId?: string; projectId?: string }) {
  let requestId = opts.requestId;
  let projectId = opts.projectId;
  if (projectId) {
    const p = await prisma.project.findFirst({ where: { AND: [{ id: projectId }, projectScope(actor)] }, select: { requestId: true } });
    if (!p) throw new NotFoundError();
    requestId = p.requestId;
  } else if (requestId) {
    const r = await prisma.serviceRequest.findFirst({ where: { AND: [{ id: requestId }, requestScope(actor)] }, select: { project: { select: { id: true } } } });
    if (!r) throw new NotFoundError();
    projectId = r.project?.id;
  }
  const [reqHist, projHist, approvals, completion, acceptance, scope] = await Promise.all([
    requestId ? prisma.requestStatusHistory.findMany({ where: { requestId }, include: { actor: { select: { name: true, userType: true } } } }) : [],
    projectId ? prisma.projectStatusHistory.findMany({ where: { projectId }, include: { actor: { select: { name: true, userType: true } } } }) : [],
    requestId ? prisma.approvalDecision.findMany({ where: { requestId }, include: { step: true, decidedBy: { select: { name: true, userType: true } } } }) : [],
    projectId ? prisma.completionSubmission.findMany({ where: { projectId, reviewedAt: { not: null } }, include: { reviewedBy: { select: { name: true, userType: true } } } }) : [],
    projectId ? prisma.acceptanceDecision.findMany({ where: { projectId }, include: { decidedBy: { select: { name: true, userType: true } } } }) : [],
    projectId ? prisma.scopeChangeRequest.findMany({ where: { projectId, decidedAt: { not: null } }, include: { decidedBy: { select: { name: true, userType: true } } } }) : [],
  ]);
  const show = (u: { name: string; userType: string } | null | undefined) => (!u ? "System" : actor.userType === "MDA_USER" && u.userType !== "MDA_USER" ? "KATDICT" : u.name);
  const items = [
    ...reqHist.map((h) => ({ at: h.createdAt, scope: "Request", action: h.action.replace(/_/g, " "), actor: show(h.actor), from: h.fromStatus, to: h.toStatus, reason: h.reason, evidence: null as string | null })),
    ...projHist.map((h) => ({ at: h.createdAt, scope: "Project", action: h.action.replace(/_/g, " "), actor: show(h.actor), from: h.fromStatus, to: h.toStatus, reason: h.reason, evidence: null })),
    ...approvals.map((a) => ({ at: a.createdAt, scope: "Approval", action: `${a.step.name}: ${a.outcome.toLowerCase()} (cycle ${a.cycle})`, actor: show(a.decidedBy), from: null, to: null, reason: a.reason, evidence: null })),
    ...completion.map((c) => ({ at: c.reviewedAt!, scope: "Completion review", action: `Cycle ${c.cycle}: ${c.status.toLowerCase().replace(/_/g, " ")}`, actor: show(c.reviewedBy), from: null, to: null, reason: c.reviewNotes, evidence: `Submission ${c.cycle}` })),
    ...acceptance.map((a) => ({ at: a.createdAt, scope: "MDA acceptance", action: a.outcome.toLowerCase().replace(/_/g, " "), actor: show(a.decidedBy), from: null, to: null, reason: a.reason, evidence: null })),
    ...scope.map((s) => ({ at: s.decidedAt!, scope: "Scope change", action: s.status.toLowerCase(), actor: show(s.decidedBy), from: null, to: null, reason: s.decisionReason, evidence: s.proposedChange.slice(0, 140) })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  return { items, includesAuditLink: can(actor, "audit.read") };
}
