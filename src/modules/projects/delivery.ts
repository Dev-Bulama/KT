import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/modules/audit/audit";
import { mdaAdminIds, notify, usersWithPermission } from "@/modules/notifications/service";
import type { Actor } from "@/modules/rbac/actor";
import { assertCan, can } from "@/modules/rbac/authorize";
import { canSeeInternal } from "@/modules/rbac/scope";
import { assertCanWorkOnProject, loadScopedProject } from "./access";
import { wouldCreateCycle } from "./eligibility";
import { escalationRecipients, projectTeamIds, recalculateProgress, recordProjectStatus } from "./service";
import { TERMINAL_PROJECT_STATUSES } from "./workflow";

const optDate = z
  .union([z.string(), z.date()])
  .optional()
  .transform((v) => (v ? new Date(v) : null))
  .refine((d) => !d || !Number.isNaN(d.getTime()), "Invalid date");

function vErr(e: z.ZodError) {
  return new ValidationError("Please correct the highlighted fields.", e.flatten().fieldErrors as Record<string, string[]>);
}

async function workable(actor: Actor, projectId: string) {
  const p = await loadScopedProject(prisma, actor, projectId, {});
  await assertCanWorkOnProject(prisma, actor, p);
  if (TERMINAL_PROJECT_STATUSES.includes(p.status)) throw new AppError("This project is closed; records can no longer be changed.");
  return p;
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export const milestoneSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(3000).optional(),
  dueDate: optDate,
  weight: z.coerce.number().int().min(1).max(100).default(1),
  visibleToMda: z.coerce.boolean().default(true),
});

export async function createMilestone(actor: Actor, projectId: string, raw: unknown) {
  const parsed = milestoneSchema.safeParse(raw);
  if (!parsed.success) throw vErr(parsed.error);
  await workable(actor, projectId);
  await prisma.$transaction(async (tx) => {
    const count = await tx.projectMilestone.count({ where: { projectId } });
    const m = await tx.projectMilestone.create({ data: { projectId, ...parsed.data, sortOrder: count } });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "project.milestone_created", entityType: "ProjectMilestone", entityId: m.id, after: { projectId, title: m.title, dueDate: m.dueDate, weight: m.weight } });
    await recalculateProgress(tx, projectId, actor.id);
  });
}

export async function setMilestoneStatus(actor: Actor, milestoneId: string, status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED") {
  const m = await prisma.projectMilestone.findUnique({ where: { id: milestoneId }, include: { tasks: true } });
  if (!m) throw new NotFoundError();
  const p = await workable(actor, m.projectId);
  if (!["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(status)) throw new ValidationError("Invalid status.");
  if (status === "COMPLETED") {
    const open = m.tasks.filter((t) => !["DONE", "CANCELLED"].includes(t.status));
    if (open.length) throw new AppError(`Complete or cancel the ${open.length} open task(s) of this milestone first.`);
    if (!["IN_PROGRESS", "BLOCKED"].includes(p.status)) throw new AppError("Milestones can only be completed while the project is in progress.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.projectMilestone.update({ where: { id: m.id }, data: { status, completedAt: status === "COMPLETED" ? new Date() : null } });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "project.milestone_status", entityType: "ProjectMilestone", entityId: m.id, before: { status: m.status }, after: { status } });
    await recalculateProgress(tx, m.projectId, actor.id);
    if (status === "COMPLETED") {
      const recipients = [...(await projectTeamIds(tx, p.id)), ...(m.visibleToMda ? await mdaAdminIds(tx, p.mdaId) : [])];
      await notify(tx, { userIds: recipients, type: "project.milestone_completed", title: `Milestone completed: ${m.title}`, body: `Milestone "${m.title}" of ${p.reference} was completed.`, link: `/projects/${p.id}`, email: false });
    }
  });
}

// ---------------------------------------------------------------------------
// Tasks and dependencies
// ---------------------------------------------------------------------------

export const taskSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(3000).optional(),
  milestoneId: z.string().cuid().optional().or(z.literal("").transform(() => undefined)),
  assigneeId: z.string().cuid().optional().or(z.literal("").transform(() => undefined)),
  dueDate: optDate,
  weight: z.coerce.number().int().min(1).max(100).default(1),
});

export async function createTask(actor: Actor, projectId: string, raw: unknown) {
  const parsed = taskSchema.safeParse(raw);
  if (!parsed.success) throw vErr(parsed.error);
  await workable(actor, projectId);
  const t = parsed.data;
  if (t.milestoneId && !(await prisma.projectMilestone.findFirst({ where: { id: t.milestoneId, projectId } }))) throw new ValidationError("Milestone not found on this project.");
  if (t.assigneeId) {
    const member = await prisma.project.findFirst({ where: { id: projectId, OR: [{ projectManagerId: t.assigneeId }, { assignments: { some: { assigneeId: t.assigneeId, status: { in: ["PENDING_ACKNOWLEDGMENT", "ACKNOWLEDGED"] } } } }] } });
    if (!member) throw new ValidationError("Tasks can only be assigned to members of the project team.");
  }
  await prisma.$transaction(async (tx) => {
    const task = await tx.projectTask.create({ data: { projectId, createdById: actor.id, ...t, milestoneId: t.milestoneId ?? null, assigneeId: t.assigneeId ?? null } });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "project.task_created", entityType: "ProjectTask", entityId: task.id, after: { projectId, title: task.title, assigneeId: task.assigneeId } });
    await recalculateProgress(tx, projectId, actor.id);
  });
}

export async function setTaskStatus(actor: Actor, taskId: string, status: "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED") {
  if (!["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"].includes(status)) throw new ValidationError("Invalid status.");
  const task = await prisma.projectTask.findUnique({ where: { id: taskId }, include: { dependsOn: { include: { dependsOn: true } } } });
  if (!task) throw new NotFoundError();
  await workable(actor, task.projectId);
  if (status === "DONE" || status === "IN_PROGRESS") {
    const unmet = task.dependsOn.filter((d) => d.dependsOn.status !== "DONE" && d.dependsOn.status !== "CANCELLED");
    if (unmet.length) throw new AppError(`This task depends on unfinished tasks: ${unmet.map((d) => d.dependsOn.title).join(", ")}.`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.projectTask.update({ where: { id: taskId }, data: { status, completedAt: status === "DONE" ? new Date() : null } });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "project.task_status", entityType: "ProjectTask", entityId: taskId, before: { status: task.status }, after: { status } });
    await recalculateProgress(tx, task.projectId, actor.id);
  });
}

export async function addTaskDependency(actor: Actor, taskId: string, dependsOnId: string) {
  const [task, dep] = await Promise.all([prisma.projectTask.findUnique({ where: { id: taskId } }), prisma.projectTask.findUnique({ where: { id: dependsOnId } })]);
  if (!task || !dep || task.projectId !== dep.projectId) throw new ValidationError("Both tasks must belong to the same project.");
  await workable(actor, task.projectId);
  const edges = await prisma.taskDependency.findMany({ where: { task: { projectId: task.projectId } } });
  if (wouldCreateCycle(edges, taskId, dependsOnId)) throw new ValidationError("This dependency would create a circular chain.");
  await prisma.taskDependency.upsert({ where: { taskId_dependsOnId: { taskId, dependsOnId } }, create: { taskId, dependsOnId }, update: {} });
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "project.task_dependency_added", entityType: "ProjectTask", entityId: taskId, after: { dependsOnId } });
}

// ---------------------------------------------------------------------------
// Work logs
// ---------------------------------------------------------------------------

export const workLogSchema = z.object({
  taskId: z.string().cuid().optional().or(z.literal("").transform(() => undefined)),
  workDate: z.union([z.string(), z.date()]).transform((v) => new Date(v)).refine((d) => !Number.isNaN(d.getTime()) && d <= new Date(Date.now() + 86400_000), "Work date cannot be in the future"),
  hours: z.coerce.number().positive().max(24),
  description: z.string().trim().min(5).max(3000),
});

export async function addWorkLog(actor: Actor, projectId: string, raw: unknown) {
  const parsed = workLogSchema.safeParse(raw);
  if (!parsed.success) throw vErr(parsed.error);
  await workable(actor, projectId);
  if (parsed.data.taskId && !(await prisma.projectTask.findFirst({ where: { id: parsed.data.taskId, projectId } }))) throw new ValidationError("Task not found on this project.");
  const log = await prisma.projectWorkLog.create({ data: { projectId, userId: actor.id, ...parsed.data, taskId: parsed.data.taskId ?? null } });
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "project.worklog_added", entityType: "ProjectWorkLog", entityId: log.id, after: { projectId, hours: parsed.data.hours } });
}

// ---------------------------------------------------------------------------
// Risks and blockers
// ---------------------------------------------------------------------------

export const riskSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(3000).optional(),
  likelihood: z.coerce.number().int().min(1).max(5),
  impact: z.coerce.number().int().min(1).max(5),
  mitigation: z.string().trim().max(3000).optional(),
});

export function riskLevelFromScore(score: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (score >= 20) return "CRITICAL";
  if (score >= 12) return "HIGH";
  if (score >= 6) return "MEDIUM";
  return "LOW";
}

export async function addRisk(actor: Actor, projectId: string, raw: unknown) {
  const parsed = riskSchema.safeParse(raw);
  if (!parsed.success) throw vErr(parsed.error);
  const p = await workable(actor, projectId);
  await prisma.$transaction(async (tx) => {
    const r = await tx.projectRisk.create({ data: { projectId, raisedById: actor.id, ownerId: actor.id, ...parsed.data } });
    // Project risk level = highest open risk score band.
    const open = await tx.projectRisk.findMany({ where: { projectId, status: "OPEN" } });
    const level = riskLevelFromScore(Math.max(0, ...open.map((x) => x.likelihood * x.impact)));
    if (level !== p.riskLevel) await tx.project.update({ where: { id: projectId }, data: { riskLevel: level } });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "project.risk_recorded", entityType: "ProjectRisk", entityId: r.id, after: { projectId, title: r.title, score: r.likelihood * r.impact, projectRiskLevel: level } });
  });
}

export async function setRiskStatus(actor: Actor, riskId: string, status: "OPEN" | "MITIGATED" | "CLOSED") {
  const r = await prisma.projectRisk.findUnique({ where: { id: riskId } });
  if (!r) throw new NotFoundError();
  await workable(actor, r.projectId);
  await prisma.$transaction(async (tx) => {
    await tx.projectRisk.update({ where: { id: riskId }, data: { status } });
    const open = await tx.projectRisk.findMany({ where: { projectId: r.projectId, status: "OPEN" } });
    await tx.project.update({ where: { id: r.projectId }, data: { riskLevel: riskLevelFromScore(Math.max(0, ...open.map((x) => x.likelihood * x.impact))) } });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "project.risk_status", entityType: "ProjectRisk", entityId: riskId, before: { status: r.status }, after: { status } });
  });
}

export async function raiseBlocker(actor: Actor, projectId: string, description: string, markBlocked: boolean) {
  if (!description?.trim() || description.length > 3000) throw new ValidationError("Describe the blocker (up to 3000 characters).");
  const p = await workable(actor, projectId);
  await prisma.$transaction(async (tx) => {
    const b = await tx.projectBlocker.create({ data: { projectId, description: description.trim(), raisedById: actor.id } });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "project.blocker_raised", entityType: "ProjectBlocker", entityId: b.id, after: { projectId } });
    if (markBlocked && p.status === "IN_PROGRESS") {
      await tx.project.update({ where: { id: projectId }, data: { status: "BLOCKED", version: { increment: 1 } } });
      await recordProjectStatus(tx, projectId, "IN_PROGRESS", "BLOCKED", "blocker_raised", actor.id, description);
    }
    await notify(tx, { userIds: await escalationRecipients(tx, p.departmentId), type: "project.blocked", title: `Blocker reported: ${p.reference}`, body: description.trim(), link: `/projects/${projectId}` });
  });
}

export async function resolveBlocker(actor: Actor, blockerId: string, resolution: string) {
  if (!resolution?.trim()) throw new ValidationError("Describe how the blocker was resolved.");
  const b = await prisma.projectBlocker.findUnique({ where: { id: blockerId } });
  if (!b) throw new NotFoundError();
  if (b.resolvedAt) throw new AppError("This blocker is already resolved.");
  await workable(actor, b.projectId);
  await prisma.$transaction(async (tx) => {
    await tx.projectBlocker.update({ where: { id: blockerId }, data: { resolvedAt: new Date(), resolvedById: actor.id, resolution: resolution.trim() } });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "project.blocker_resolved", entityType: "ProjectBlocker", entityId: blockerId, after: { resolution } });
  });
}

// ---------------------------------------------------------------------------
// Deliverables
// ---------------------------------------------------------------------------

export async function addDeliverable(actor: Actor, projectId: string, title: string, description: string | undefined, required: boolean) {
  if (!title?.trim() || title.length > 200) throw new ValidationError("Deliverable title is required.");
  await workable(actor, projectId);
  const d = await prisma.projectDeliverable.create({ data: { projectId, title: title.trim(), description: description?.trim() || null, required } });
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "project.deliverable_added", entityType: "ProjectDeliverable", entityId: d.id, after: { projectId, title: d.title, required } });
}

/** Marks a deliverable as submitted; requires at least one uploaded file. */
export async function submitDeliverable(actor: Actor, deliverableId: string) {
  const d = await prisma.projectDeliverable.findUnique({ where: { id: deliverableId }, include: { _count: { select: { attachments: true } } } });
  if (!d) throw new NotFoundError();
  await workable(actor, d.projectId);
  if (d._count.attachments === 0) throw new AppError("Upload at least one file for this deliverable before submitting it.");
  await prisma.projectDeliverable.update({ where: { id: d.id }, data: { status: "SUBMITTED", submittedAt: new Date() } });
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "project.deliverable_submitted", entityType: "ProjectDeliverable", entityId: d.id, after: { projectId: d.projectId } });
}

// ---------------------------------------------------------------------------
// Communications
// ---------------------------------------------------------------------------

export async function addProjectComment(actor: Actor, projectId: string, body: string, visibility: "INTERNAL" | "MDA_VISIBLE", mentions: string[] = []) {
  const text = body?.trim();
  if (!text || text.length > 5000) throw new ValidationError("Message must be 1–5000 characters.");
  const p = await loadScopedProject(prisma, actor, projectId, {});
  if (actor.userType === "OVERSIGHT") throw new ForbiddenError("Oversight accounts are read-only.");
  const vis = actor.userType === "MDA_USER" ? "MDA_VISIBLE" : visibility;
  if (vis === "INTERNAL") assertCan(actor, "project.comment.internal");
  else assertCan(actor, "project.comment.external");
  if (actor.userType === "MDA_USER" && p.mdaId !== actor.mdaId) throw new ForbiddenError();
  const team = await projectTeamIds(prisma, projectId);
  // Mentions are limited to the project team (and, for MDA-visible messages, MDA admins).
  const mdaIds = vis === "MDA_VISIBLE" ? await mdaAdminIds(prisma, p.mdaId) : [];
  const allowedMentions = mentions.filter((m) => team.includes(m) || mdaIds.includes(m));
  await prisma.$transaction(async (tx) => {
    const c = await tx.projectComment.create({ data: { projectId, authorId: actor.id, body: text, visibility: vis, mentions: allowedMentions } });
    await tx.commentRead.create({ data: { commentId: c.id, userId: actor.id } });
    const recipients = new Set<string>([...team, ...allowedMentions]);
    if (vis === "MDA_VISIBLE" && actor.userType !== "MDA_USER") mdaIds.forEach((id) => recipients.add(id));
    recipients.delete(actor.id);
    await notify(tx, {
      userIds: [...recipients], type: "project.comment", title: `${vis === "INTERNAL" ? "Internal note" : "New message"} on ${p.reference}`,
      body: `${actor.name}: ${text.slice(0, 400)}`, link: `/projects/${projectId}?tab=communications`, email: allowedMentions.length > 0,
    });
  });
}

export async function listProjectComments(actor: Actor, projectId: string) {
  await loadScopedProject(prisma, actor, projectId, {});
  const internal = canSeeInternal(actor);
  const comments = await prisma.projectComment.findMany({
    where: { projectId, ...(internal ? {} : { visibility: "MDA_VISIBLE" }) },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true, userType: true } }, reads: { select: { userId: true } } },
    take: 500,
  });
  // Mark as read (read indicators).
  const unread = comments.filter((c) => !c.reads.some((r) => r.userId === actor.id)).map((c) => c.id);
  if (unread.length) {
    await prisma.commentRead.createMany({ data: unread.map((commentId) => ({ commentId, userId: actor.id })), skipDuplicates: true });
  }
  return comments.map((c) => ({ ...c, readCount: c.reads.length }));
}

// ---------------------------------------------------------------------------
// Change control
// ---------------------------------------------------------------------------

export const scopeChangeSchema = z.object({
  proposedChange: z.string().trim().min(10).max(10000),
  reason: z.string().trim().min(5).max(5000),
  impactAssessment: z.string().trim().max(5000).optional(),
  scheduleImpactDays: z.coerce.number().int().min(-365).max(3650).optional(),
  resourceImpact: z.string().trim().max(3000).optional(),
});

export async function requestScopeChange(actor: Actor, projectId: string, raw: unknown) {
  assertCan(actor, "project.scope.request");
  const parsed = scopeChangeSchema.safeParse(raw);
  if (!parsed.success) throw vErr(parsed.error);
  const p = await loadScopedProject(prisma, actor, projectId, {});
  if (TERMINAL_PROJECT_STATUSES.includes(p.status) || p.status === "ACCEPTED") throw new AppError("Scope cannot change after acceptance or closure.");
  if (actor.userType === "MDA_USER" && p.mdaId !== actor.mdaId) throw new ForbiddenError();
  if (actor.userType === "KATDICT_STAFF") await assertCanWorkOnProject(prisma, actor, p);
  await prisma.$transaction(async (tx) => {
    const sc = await tx.scopeChangeRequest.create({
      data: { projectId, requestedById: actor.id, requestingParty: actor.userType === "MDA_USER" ? "MDA" : "KATDICT", originalScope: p.approvedScope, ...parsed.data },
    });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "project.scope_change_requested", entityType: "ScopeChangeRequest", entityId: sc.id, after: { projectId, ...parsed.data } });
    await notify(tx, { userIds: await usersWithPermission(tx, "project.scope.decide"), type: "project.scope_change", title: `Scope change requested: ${p.reference}`, body: parsed.data.proposedChange.slice(0, 500), link: `/projects/${projectId}?tab=changes` });
  });
}

export async function decideScopeChange(actor: Actor, scopeChangeId: string, approve: boolean, reason: string) {
  assertCan(actor, "project.scope.decide");
  if (!reason?.trim()) throw new ValidationError("A decision reason is required.");
  const sc = await prisma.scopeChangeRequest.findUnique({ where: { id: scopeChangeId } });
  if (!sc) throw new NotFoundError();
  const p = await loadScopedProject(prisma, actor, sc.projectId, {});
  if (sc.status !== "PENDING") throw new AppError("This change request has already been decided.");
  if (sc.requestedById === actor.id) throw new ForbiddenError("You cannot decide your own scope change request.");
  await prisma.$transaction(async (tx) => {
    const res = await tx.scopeChangeRequest.updateMany({
      where: { id: sc.id, status: "PENDING" },
      data: { status: approve ? "APPROVED" : "REJECTED", decidedById: actor.id, decidedAt: new Date(), decisionReason: reason.trim() },
    });
    if (res.count !== 1) throw new AppError("This change request has already been decided.");
    if (approve) {
      // Approved scope is versioned through ScopeChangeRequest rows; the original text is preserved there.
      const newScope = `${p.approvedScope}\n\n[Approved change ${new Date().toISOString().slice(0, 10)}] ${sc.proposedChange}`;
      const newEnd = p.plannedEndDate && sc.scheduleImpactDays ? new Date(p.plannedEndDate.getTime() + sc.scheduleImpactDays * 86400_000) : p.plannedEndDate;
      await tx.project.update({ where: { id: p.id }, data: { approvedScope: newScope, plannedEndDate: newEnd, version: { increment: 1 } } });
      await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "project.scope_changed", entityType: "Project", entityId: p.id, before: { approvedScope: p.approvedScope, plannedEndDate: p.plannedEndDate }, after: { approvedScope: newScope, plannedEndDate: newEnd }, reason });
    }
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: approve ? "project.scope_change_approved" : "project.scope_change_rejected", entityType: "ScopeChangeRequest", entityId: sc.id, reason });
    await notify(tx, {
      userIds: [sc.requestedById, ...(await projectTeamIds(tx, p.id)), ...(await mdaAdminIds(tx, p.mdaId))], type: "project.scope_change",
      title: `Scope change ${approve ? "approved" : "rejected"}: ${p.reference}`, body: `Decision: ${reason}`, link: `/projects/${p.id}?tab=changes`,
    });
  });
}

export function canManageDelivery(actor: Actor) {
  return actor.userType === "KATDICT_STAFF" && can(actor, "project.update");
}
