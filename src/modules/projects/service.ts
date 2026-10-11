import type { Prisma, ProjectStatus } from "@/generated/prisma/client";
import { prisma, type Db, type Tx } from "@/lib/db";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { nextReference } from "@/lib/reference";
import { audit } from "@/modules/audit/audit";
import { mdaAdminIds, notify, usersWithPermission } from "@/modules/notifications/service";
import type { Actor } from "@/modules/rbac/actor";
import { assertCan, can } from "@/modules/rbac/authorize";
import { canSeeInternal, projectScope } from "@/modules/rbac/scope";
import { checkRequestTransition } from "@/modules/requests/workflow";
import { getSetting } from "@/modules/settings/service";
import { calculateProgress } from "./progress";
import { checkProjectTransition, type ProjectAction } from "./workflow";
import { isAssignedToProject, loadScopedProject } from "./access";

// ---------------------------------------------------------------------------
// Initiation
// ---------------------------------------------------------------------------

export async function initiateProject(actor: Actor, requestId: string, expectedVersion: number) {
  assertCan(actor, "project.create");
  const req = await prisma.serviceRequest.findUnique({ where: { id: requestId }, include: { service: true } });
  if (!req) throw new NotFoundError();
  const check = checkRequestTransition("initiate_project", req.status, actor.permissions);
  if (!check.ok) throw new AppError(check.error);

  return prisma.$transaction(async (tx) => {
    const res = await tx.serviceRequest.updateMany({
      where: { id: requestId, version: expectedVersion, status: "APPROVED" },
      data: { status: "PROJECT_INITIATED", version: { increment: 1 } },
    });
    if (res.count !== 1) throw new ConflictError();
    const reference = await nextReference(tx, "PRJ");
    const project = await tx.project.create({
      data: {
        reference, requestId, mdaId: req.mdaId, departmentId: req.assignedDepartmentId, title: req.title,
        description: req.problemStatement ?? req.title, approvedScope: req.proposedScope ?? "Scope as described in the approved request.",
        priority: req.priority ?? req.urgency, estimatedEffortDays: req.estimatedEffortDays, status: "APPROVED",
        plannedEndDate: req.preferredCompletionDate,
        deliverables: { create: req.service.standardDeliverables.map((title) => ({ title, required: true })) },
      },
    });
    await tx.requestStatusHistory.create({ data: { requestId, fromStatus: "APPROVED", toStatus: "PROJECT_INITIATED", action: "initiate_project", actorId: actor.id } });
    await tx.projectStatusHistory.create({ data: { projectId: project.id, toStatus: "APPROVED", action: "initiate", actorId: actor.id } });
    await audit(tx, {
      actorId: actor.id, actorEmail: actor.email, action: "project.initiated", entityType: "Project", entityId: project.id,
      after: { reference, requestId, requestReference: req.reference },
    });
    await notify(tx, {
      userIds: [req.createdById, ...(await mdaAdminIds(tx, req.mdaId))], type: "project.status_changed",
      title: `Project initiated: ${reference}`, body: `A project has been initiated for your request "${req.title}" (${req.reference}).`, link: `/projects/${project.id}`,
    });
    return project;
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface ProjectListFilters {
  q?: string;
  status?: string;
  mdaId?: string;
  departmentId?: string;
  managerId?: string;
  overdue?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listProjects(actor: Actor, f: ProjectListFilters = {}) {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, f.pageSize ?? 20));
  const where: Prisma.ProjectWhereInput = {
    AND: [
      projectScope(actor),
      f.q ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { reference: { contains: f.q, mode: "insensitive" } }] } : {},
      f.status ? { status: f.status as ProjectStatus } : {},
      f.mdaId ? { mdaId: f.mdaId } : {},
      f.departmentId ? { departmentId: f.departmentId } : {},
      f.managerId ? { projectManagerId: f.managerId } : {},
      f.overdue ? { plannedEndDate: { lt: new Date() }, status: { notIn: ["CLOSED", "CANCELLED", "ACCEPTED"] } } : {},
    ],
  };
  const [items, total] = await Promise.all([
    prisma.project.findMany({
      where, orderBy: [{ updatedAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize,
      select: {
        id: true, reference: true, title: true, status: true, acceptanceStatus: true, priority: true, riskLevel: true,
        progressPercent: true, plannedEndDate: true, updatedAt: true,
        mda: { select: { name: true, abbreviation: true } }, department: { select: { name: true } },
        projectManager: { select: { name: true } },
      },
    }),
    prisma.project.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getProject(actor: Actor, id: string) {
  const internal = canSeeInternal(actor);
  const p = await loadScopedProject(prisma, actor, id, {
    request: { select: { id: true, reference: true, title: true, problemStatement: true, desiredOutcome: true, service: { select: { name: true, category: { select: { name: true } } } } } },
    mda: { select: { id: true, name: true, abbreviation: true } },
    department: { select: { id: true, name: true, headId: true } },
    projectManager: { select: { id: true, name: true, email: true } },
    assignments: { orderBy: { assignedAt: "desc" }, include: { assignee: { select: { id: true, name: true, email: true } }, assignedBy: { select: { name: true } } } },
    milestones: { where: internal ? {} : { visibleToMda: true }, orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }], include: { _count: { select: { tasks: true } } } },
    tasks: internal ? { orderBy: [{ dueDate: "asc" }], include: { assignee: { select: { id: true, name: true } }, dependsOn: true } } : false,
    deliverables: { orderBy: { createdAt: "asc" }, include: { attachments: { where: internal ? {} : { visibility: "MDA_VISIBLE" } } } },
    risks: internal ? { orderBy: { createdAt: "desc" }, include: { owner: { select: { name: true } } } } : false,
    blockers: internal ? { orderBy: { raisedAt: "desc" }, include: { raisedBy: { select: { name: true } } } } : false,
    workLogs: internal ? { orderBy: { workDate: "desc" }, take: 50, include: { user: { select: { name: true } } } } : false,
    scopeChanges: { orderBy: { createdAt: "desc" }, include: { requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } } } },
    completionSubmissions: { orderBy: { cycle: "desc" }, include: { submittedBy: { select: { name: true } }, reviewedBy: { select: { name: true } }, attachments: { where: internal ? {} : { visibility: "MDA_VISIBLE" } } } },
    acceptanceDecisions: { orderBy: { createdAt: "desc" }, include: { decidedBy: { select: { name: true } } } },
    closure: { include: { closedBy: { select: { name: true } } } },
    history: { orderBy: { createdAt: "asc" }, include: { actor: { select: { name: true, userType: true } } } },
    attachments: { where: internal ? {} : { visibility: "MDA_VISIBLE" }, orderBy: { createdAt: "desc" }, include: { uploadedBy: { select: { name: true } } } },
    reports: { orderBy: { version: "desc" }, select: { id: true, version: true, status: true, generatedAt: true, type: true } },
    feedback: { select: { id: true, rating: true, comments: true, userId: true, createdAt: true } },
  });
  const isAssigned = await isAssignedToProject(prisma, actor.id, id);
  return { project: p, internal, isAssigned };
}

// ---------------------------------------------------------------------------
// Execution status transitions
// ---------------------------------------------------------------------------

export async function recordProjectStatus(tx: Tx, projectId: string, from: ProjectStatus, to: ProjectStatus, action: string, actorId: string | null, reason?: string | null) {
  await tx.projectStatusHistory.create({ data: { projectId, fromStatus: from, toStatus: to, action, actorId, reason: reason ?? null } });
}

export async function transitionProject(actor: Actor, id: string, action: ProjectAction | string, reason: string | undefined, expectedVersion: number) {
  if (action === "close" || action === "close_exceptional") throw new AppError("Use the closure form to close projects.");
  const p = await loadScopedProject(prisma, actor, id, { mda: true });
  if (actor.userType !== "KATDICT_STAFF") throw new ForbiddenError();
  const assigned = await isAssignedToProject(prisma, actor.id, id);
  const isDeptHead = !!p.departmentId && actor.headOfDepartmentIds.includes(p.departmentId);
  const check = checkProjectTransition(action, p.status, { permissions: actor.permissions, isAssigned: assigned || isDeptHead }, reason);
  if (!check.ok) throw check.code === "FORBIDDEN" || check.code === "NOT_ASSIGNED" ? new ForbiddenError(check.error) : new AppError(check.error);
  const to = check.rule.to;
  if (action === "start_work") {
    const pmAck = await prisma.projectAssignment.findFirst({ where: { projectId: id, role: "PROJECT_MANAGER", status: "ACKNOWLEDGED" } });
    if (!pmAck) throw new AppError("The project manager must acknowledge the assignment before work starts.");
  }
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const res = await tx.project.updateMany({
      where: { id, version: expectedVersion, status: p.status },
      data: {
        status: to, version: { increment: 1 },
        ...(action === "start_work" && !p.startedAt ? { startedAt: now, startDate: p.startDate ?? now } : {}),
        ...(to === "CANCELLED" ? { actualEndDate: now } : {}),
      },
    });
    if (res.count !== 1) throw new ConflictError();
    await recordProjectStatus(tx, id, p.status, to, action, actor.id, reason);
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: `project.${action}`, entityType: "Project", entityId: id, before: { status: p.status }, after: { status: to }, reason });
    const team = await projectTeamIds(tx, id);
    const mdaIds = await mdaAdminIds(tx, p.mdaId);
    await notify(tx, {
      userIds: to === "BLOCKED" ? [...team, ...(await escalationRecipients(tx, p.departmentId))] : [...team, ...mdaIds],
      type: to === "BLOCKED" ? "project.blocked" : "project.status_changed",
      title: `${p.reference}: ${to.replace(/_/g, " ").toLowerCase()}`,
      body: `Project "${p.title}" is now ${to.replace(/_/g, " ").toLowerCase()}.${reason ? `\n\nReason: ${reason}` : ""}`,
      link: `/projects/${id}`,
    });
  });
}

export async function projectTeamIds(db: Db, projectId: string): Promise<string[]> {
  const p = await db.project.findUnique({
    where: { id: projectId },
    select: { projectManagerId: true, assignments: { where: { status: { in: ["PENDING_ACKNOWLEDGMENT", "ACKNOWLEDGED"] } }, select: { assigneeId: true } } },
  });
  if (!p) return [];
  return [...new Set([p.projectManagerId, ...p.assignments.map((a) => a.assigneeId)].filter(Boolean) as string[])];
}

export async function escalationRecipients(db: Db, departmentId: string | null): Promise<string[]> {
  const ids = new Set<string>(await usersWithPermission(db, "project.assign"));
  if (departmentId) {
    const d = await db.department.findUnique({ where: { id: departmentId }, select: { headId: true } });
    if (d?.headId) ids.add(d.headId);
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/** Recomputes the cached progress percentage from milestones/tasks; audits changes. */
export async function recalculateProgress(tx: Tx, projectId: string, actorId: string | null): Promise<number> {
  const method = await getSetting("progress.method");
  const [project, milestones, tasks] = await Promise.all([
    tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { progressPercent: true } }),
    tx.projectMilestone.findMany({ where: { projectId }, select: { id: true, weight: true, status: true } }),
    tx.projectTask.findMany({ where: { projectId }, select: { weight: true, status: true, milestoneId: true } }),
  ]);
  const next = calculateProgress(method, milestones, tasks);
  if (next !== project.progressPercent) {
    await tx.project.update({ where: { id: projectId }, data: { progressPercent: next } });
    await audit(tx, { actorId, action: "project.progress_updated", entityType: "Project", entityId: projectId, before: { progressPercent: project.progressPercent }, after: { progressPercent: next, method } });
  }
  return next;
}

export function canSeeProjectInternals(actor: Actor) {
  return canSeeInternal(actor) || can(actor, "project.read.all");
}
