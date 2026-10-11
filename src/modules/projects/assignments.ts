import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/modules/audit/audit";
import { notify } from "@/modules/notifications/service";
import type { Actor } from "@/modules/rbac/actor";
import { getSetting } from "@/modules/settings/service";
import { canAssignOnProject, loadScopedProject } from "./access";
import { checkAssignmentEligibility } from "./eligibility";
import { escalationRecipients, recordProjectStatus } from "./service";

const optDate = z.union([z.string(), z.date()]).optional().transform((v) => (v ? new Date(v) : undefined)).refine((d) => !d || !Number.isNaN(d.getTime()), "Invalid date");

export const assignSchema = z.object({
  departmentId: z.string().cuid().optional(),
  projectManagerId: z.string().cuid("Select a project manager"),
  officerIds: z.array(z.string().cuid()).max(20).default([]),
  instructions: z.string().trim().min(5, "Provide assignment instructions").max(5000),
  expectedOutcomes: z.string().trim().min(5, "Describe the expected outcomes").max(5000),
  startDate: optDate,
  plannedEndDate: optDate,
  estimatedEffortDays: z.coerce.number().int().min(1).max(3650).optional(),
  requiredResources: z.string().trim().max(3000).optional(),
  dependenciesNote: z.string().trim().max(3000).optional(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  reportingFrequency: z.enum(["WEEKLY", "FORTNIGHTLY", "MONTHLY"]).optional(),
  allowOverCapacity: z.boolean().default(false),
});

async function loadCandidate(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      _count: { select: { assignments: { where: { status: { in: ["PENDING_ACKNOWLEDGMENT", "ACKNOWLEDGED"] }, project: { status: { notIn: ["CLOSED", "CANCELLED"] } } } } } },
    },
  });
  if (!u) return null;
  const permissions = new Set(u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key)));
  return {
    user: u,
    candidate: {
      id: u.id, status: u.status, userType: u.userType, departmentId: u.departmentId, permissions,
      activeAssignments: u._count.assignments, maxConcurrentProjects: u.maxConcurrentProjects,
    },
  };
}

/** Assigns department, project manager and officers; creates acknowledgement-tracked assignments. */
export async function assignProject(actor: Actor, projectId: string, raw: unknown, expectedVersion: number) {
  const parsed = assignSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Please correct the highlighted fields.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const input = parsed.data;
  const p = await loadScopedProject(prisma, actor, projectId, {});
  const mode = canAssignOnProject(actor, p);
  if (!mode) throw new ForbiddenError();
  if (!["APPROVED", "PLANNING"].includes(p.status)) throw new AppError("Initial assignment is only possible before implementation starts. Use reassignment instead.");
  if (input.departmentId && input.departmentId !== p.departmentId && mode !== "global") throw new ForbiddenError("Only operations administrators can change the responsible department.");
  const departmentId = input.departmentId ?? p.departmentId;
  if (!departmentId) throw new ValidationError("Select the responsible department.");
  if (input.plannedEndDate && input.startDate && input.plannedEndDate < input.startDate) throw new ValidationError("Planned completion must be after the start date.");
  if (input.officerIds.includes(input.projectManagerId)) throw new ValidationError("The project manager should not also be listed as an officer.");

  const restrict = mode === "department" ? departmentId : null;
  const people = [{ id: input.projectManagerId, role: "PROJECT_MANAGER" as const }, ...[...new Set(input.officerIds)].map((id) => ({ id, role: "OFFICER" as const }))];
  for (const person of people) {
    const c = await loadCandidate(person.id);
    if (!c) throw new ValidationError("Selected user not found.");
    const e = checkAssignmentEligibility(c.candidate, { role: person.role, restrictToDepartmentId: restrict, allowOverCapacity: input.allowOverCapacity });
    if (!e.eligible) throw new ValidationError(`${c.user.name}: ${e.reasons.join(" ")}`);
  }

  const ackHours = await getSetting("workflow.assignmentAckHours");
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const res = await tx.project.updateMany({
      where: { id: projectId, version: expectedVersion, status: p.status },
      data: {
        departmentId, projectManagerId: input.projectManagerId, status: "AWAITING_ACKNOWLEDGMENT", assignedAt: now, version: { increment: 1 },
        startDate: input.startDate ?? p.startDate, plannedEndDate: input.plannedEndDate ?? p.plannedEndDate,
        estimatedEffortDays: input.estimatedEffortDays ?? p.estimatedEffortDays, requiredResources: input.requiredResources ?? p.requiredResources,
        dependenciesNote: input.dependenciesNote ?? p.dependenciesNote, riskLevel: input.riskLevel ?? p.riskLevel,
        reportingFrequency: input.reportingFrequency ?? p.reportingFrequency,
      },
    });
    if (res.count !== 1) throw new ConflictError();
    for (const person of people) {
      const a = await tx.projectAssignment.create({
        data: {
          projectId, assigneeId: person.id, assignedById: actor.id, role: person.role, instructions: input.instructions,
          expectedOutcomes: input.expectedOutcomes, expectedAckBy: new Date(now.getTime() + ackHours * 3600_000),
        },
      });
      await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "project.assignment_created", entityType: "ProjectAssignment", entityId: a.id, after: { projectId, assigneeId: person.id, role: person.role } });
    }
    await recordProjectStatus(tx, projectId, p.status, "AWAITING_ACKNOWLEDGMENT", "assign", actor.id);
    await audit(tx, {
      actorId: actor.id, actorEmail: actor.email, action: "project.assigned", entityType: "Project", entityId: projectId,
      before: { status: p.status, departmentId: p.departmentId, projectManagerId: p.projectManagerId },
      after: { status: "AWAITING_ACKNOWLEDGMENT", departmentId, projectManagerId: input.projectManagerId, officerIds: input.officerIds },
    });
    await notify(tx, {
      userIds: people.map((x) => x.id), type: "project.assignment_created", title: `New assignment: ${p.reference}`,
      body: `You have been assigned to "${p.title}". Please acknowledge within ${ackHours} hours.\n\nInstructions: ${input.instructions}\n\nExpected outcomes: ${input.expectedOutcomes}`,
      link: `/projects/${projectId}`,
    });
  });
}

export async function acknowledgeAssignment(actor: Actor, assignmentId: string) {
  const a = await prisma.projectAssignment.findUnique({ where: { id: assignmentId }, include: { project: true } });
  if (!a || a.assigneeId !== actor.id) throw new NotFoundError();
  if (a.status !== "PENDING_ACKNOWLEDGMENT") throw new AppError("This assignment does not need acknowledgement.");
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const res = await tx.projectAssignment.updateMany({ where: { id: a.id, status: "PENDING_ACKNOWLEDGMENT" }, data: { status: "ACKNOWLEDGED", acknowledgedAt: now } });
    if (res.count !== 1) throw new ConflictError();
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "project.assignment_acknowledged", entityType: "ProjectAssignment", entityId: a.id, after: { projectId: a.projectId, role: a.role } });
    if (a.role === "PROJECT_MANAGER" && a.project.status === "AWAITING_ACKNOWLEDGMENT") {
      await tx.project.update({ where: { id: a.projectId }, data: { status: "ASSIGNED", acknowledgedAt: a.project.acknowledgedAt ?? now, version: { increment: 1 } } });
      await recordProjectStatus(tx, a.projectId, "AWAITING_ACKNOWLEDGMENT", "ASSIGNED", "acknowledge", actor.id);
    }
    await notify(tx, {
      userIds: [a.assignedById], type: "project.assignment_acknowledged", title: `Assignment acknowledged: ${a.project.reference}`,
      body: `${actor.name} acknowledged the ${a.role === "PROJECT_MANAGER" ? "project manager" : "officer"} assignment.`, link: `/projects/${a.projectId}`, email: false,
    });
  });
}

export const reassignSchema = z.object({
  assignmentId: z.string().cuid(),
  newAssigneeId: z.string().cuid(),
  reason: z.string().trim().min(5, "A reason is required").max(2000),
  instructions: z.string().trim().max(5000).optional(),
  allowOverCapacity: z.boolean().default(false),
});

export async function reassign(actor: Actor, raw: unknown) {
  const parsed = reassignSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Please correct the highlighted fields.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const input = parsed.data;
  const a = await prisma.projectAssignment.findUnique({ where: { id: input.assignmentId } });
  if (!a) throw new NotFoundError();
  const p = await loadScopedProject(prisma, actor, a.projectId, {});
  const mode = canAssignOnProject(actor, p);
  if (!mode) throw new ForbiddenError();
  if (["CLOSED", "CANCELLED"].includes(p.status)) throw new AppError("Closed projects cannot be reassigned.");
  if (!["PENDING_ACKNOWLEDGMENT", "ACKNOWLEDGED"].includes(a.status)) throw new AppError("This assignment is no longer active.");
  if (a.assigneeId === input.newAssigneeId) throw new ValidationError("Select a different person.");
  const c = await loadCandidate(input.newAssigneeId);
  if (!c) throw new ValidationError("Selected user not found.");
  const e = checkAssignmentEligibility(c.candidate, { role: a.role, restrictToDepartmentId: mode === "department" ? p.departmentId : null, allowOverCapacity: input.allowOverCapacity });
  if (!e.eligible) throw new ValidationError(e.reasons.join(" "));
  const ackHours = await getSetting("workflow.assignmentAckHours");

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const ended = await tx.projectAssignment.updateMany({ where: { id: a.id, status: a.status }, data: { status: "REASSIGNED", endedAt: now, endReason: input.reason } });
    if (ended.count !== 1) throw new ConflictError();
    const created = await tx.projectAssignment.create({
      data: {
        projectId: a.projectId, assigneeId: input.newAssigneeId, assignedById: actor.id, role: a.role,
        instructions: input.instructions || a.instructions, expectedOutcomes: a.expectedOutcomes, expectedAckBy: new Date(now.getTime() + ackHours * 3600_000),
      },
    });
    if (a.role === "PROJECT_MANAGER") {
      const back = ["ASSIGNED", "AWAITING_ACKNOWLEDGMENT"].includes(p.status);
      await tx.project.update({ where: { id: p.id }, data: { projectManagerId: input.newAssigneeId, ...(back ? { status: "AWAITING_ACKNOWLEDGMENT" } : {}), version: { increment: 1 } } });
      if (back && p.status !== "AWAITING_ACKNOWLEDGMENT") await recordProjectStatus(tx, p.id, p.status, "AWAITING_ACKNOWLEDGMENT", "reassign_pm", actor.id, input.reason);
    }
    await audit(tx, {
      actorId: actor.id, actorEmail: actor.email, action: "project.reassigned", entityType: "ProjectAssignment", entityId: created.id,
      before: { assignmentId: a.id, assigneeId: a.assigneeId }, after: { assigneeId: input.newAssigneeId, role: a.role }, reason: input.reason,
    });
    await notify(tx, { userIds: [input.newAssigneeId], type: "project.assignment_created", title: `New assignment: ${p.reference}`, body: `You have been assigned to "${p.title}" (reassignment). Please acknowledge within ${ackHours} hours.`, link: `/projects/${p.id}` });
    await notify(tx, { userIds: [a.assigneeId], type: "project.status_changed", title: `Assignment ended: ${p.reference}`, body: `Your assignment to "${p.title}" was reassigned.\n\nReason: ${input.reason}`, link: `/projects/${p.id}`, email: false });
  });
}

/** Scheduled job: escalate assignments not acknowledged within the configured period. */
export async function escalateOverdueAcknowledgements(now = new Date()): Promise<number> {
  const overdue = await prisma.projectAssignment.findMany({
    where: { status: "PENDING_ACKNOWLEDGMENT", expectedAckBy: { lt: now }, escalatedAt: null },
    include: { project: true, assignee: { select: { name: true } } },
    take: 200,
  });
  for (const a of overdue) {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.projectAssignment.updateMany({ where: { id: a.id, escalatedAt: null }, data: { escalatedAt: now } });
      if (claimed.count !== 1) return;
      await notify(tx, {
        userIds: await escalationRecipients(tx, a.project.departmentId), type: "project.assignment_overdue",
        title: `Assignment not acknowledged: ${a.project.reference}`,
        body: `${a.assignee.name} has not acknowledged the ${a.role === "PROJECT_MANAGER" ? "project manager" : "officer"} assignment for "${a.project.title}" (due ${a.expectedAckBy.toISOString().slice(0, 16).replace("T", " ")} UTC).`,
        link: `/projects/${a.projectId}`, dedupeKey: `ack-escalation:${a.id}`,
      });
      await audit(tx, { actorId: null, action: "project.assignment_escalated", entityType: "ProjectAssignment", entityId: a.id, after: { projectId: a.projectId } });
    });
  }
  return overdue.length;
}
