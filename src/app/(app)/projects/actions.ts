"use server";

import { revalidatePath } from "next/cache";
import { runAction, str, num, bool, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { requireActor } from "@/modules/auth/current";
import { transitionProject } from "@/modules/projects/service";
import { acknowledgeAssignment, assignProject, reassign } from "@/modules/projects/assignments";
import {
  addDeliverable, addProjectComment, addRisk, addTaskDependency, addWorkLog, createMilestone, createTask, decideScopeChange,
  raiseBlocker, requestScopeChange, resolveBlocker, setMilestoneStatus, setRiskStatus, setTaskStatus, submitDeliverable,
} from "@/modules/projects/delivery";
import { closeProject, mdaAcceptanceDecision, reviewCompletion, submitCompletion } from "@/modules/projects/completion";
import { generateProjectReport } from "@/modules/reports/project-report";
import { adoptProjectPlan, dismissRecommendation, suggestProjectPlan } from "@/modules/ai/features";
import { prisma } from "@/lib/db";
import { loadScopedProject } from "@/modules/projects/access";
import { assertCan } from "@/modules/rbac/authorize";

function done(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
}

async function wrap(fd: FormData, fn: (projectId: string) => Promise<string | void>) {
  const projectId = str(fd, "projectId")!;
  const res = await runAction(() => fn(projectId));
  done(projectId);
  return res;
}

export const transitionProjectAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async (id) => { await transitionProject(await requireActor(), id, str(fd, "action")!, str(fd, "reason"), num(fd, "version") ?? -1); return "Project updated."; });

export const assignAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async (id) => {
    await assignProject(await requireActor(), id, {
      departmentId: str(fd, "departmentId") || undefined, projectManagerId: str(fd, "projectManagerId"), officerIds: fd.getAll("officerIds").map(String).filter(Boolean),
      instructions: str(fd, "instructions"), expectedOutcomes: str(fd, "expectedOutcomes"), startDate: str(fd, "startDate") || undefined, plannedEndDate: str(fd, "plannedEndDate") || undefined,
      estimatedEffortDays: str(fd, "estimatedEffortDays") || undefined, requiredResources: str(fd, "requiredResources") || undefined, dependenciesNote: str(fd, "dependenciesNote") || undefined,
      riskLevel: str(fd, "riskLevel") || undefined, reportingFrequency: str(fd, "reportingFrequency") || undefined, allowOverCapacity: bool(fd, "allowOverCapacity"),
    }, num(fd, "version") ?? -1);
    return "Assignments created. Assignees have been notified.";
  });

export const acknowledgeAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async () => { await acknowledgeAssignment(await requireActor(), str(fd, "assignmentId")!); return "Assignment acknowledged."; });

export const reassignAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async () => { await reassign(await requireActor(), { assignmentId: str(fd, "assignmentId"), newAssigneeId: str(fd, "newAssigneeId"), reason: str(fd, "reason"), instructions: str(fd, "instructions") || undefined, allowOverCapacity: bool(fd, "allowOverCapacity") }); return "Reassigned."; });

export const milestoneAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async (id) => { await createMilestone(await requireActor(), id, { title: str(fd, "title"), description: str(fd, "description") || undefined, dueDate: str(fd, "dueDate") || undefined, weight: str(fd, "weight") || 1, visibleToMda: bool(fd, "visibleToMda") }); return "Milestone added."; });

export const milestoneStatusAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async () => { await setMilestoneStatus(await requireActor(), str(fd, "milestoneId")!, str(fd, "status") as never); return "Milestone updated."; });

export const taskAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async (id) => { await createTask(await requireActor(), id, { title: str(fd, "title"), description: str(fd, "description") || undefined, milestoneId: str(fd, "milestoneId"), assigneeId: str(fd, "assigneeId"), dueDate: str(fd, "dueDate") || undefined, weight: str(fd, "weight") || 1 }); return "Task added."; });

export const taskStatusAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async () => { await setTaskStatus(await requireActor(), str(fd, "taskId")!, str(fd, "status") as never); return "Task updated."; });

export const dependencyAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async () => { await addTaskDependency(await requireActor(), str(fd, "taskId")!, str(fd, "dependsOnId")!); return "Dependency added."; });

export const workLogAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async (id) => { await addWorkLog(await requireActor(), id, { taskId: str(fd, "taskId"), workDate: str(fd, "workDate"), hours: str(fd, "hours"), description: str(fd, "description") }); return "Work log recorded."; });

export const riskAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async (id) => { await addRisk(await requireActor(), id, { title: str(fd, "title"), description: str(fd, "description") || undefined, likelihood: str(fd, "likelihood"), impact: str(fd, "impact"), mitigation: str(fd, "mitigation") || undefined }); return "Risk recorded."; });

export const riskStatusAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async () => { await setRiskStatus(await requireActor(), str(fd, "riskId")!, str(fd, "status") as never); return "Risk updated."; });

export const blockerAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async (id) => { await raiseBlocker(await requireActor(), id, str(fd, "description") ?? "", bool(fd, "markBlocked")); return "Blocker reported."; });

export const resolveBlockerAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async () => { await resolveBlocker(await requireActor(), str(fd, "blockerId")!, str(fd, "resolution") ?? ""); return "Blocker resolved."; });

export const deliverableAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async (id) => { await addDeliverable(await requireActor(), id, str(fd, "title") ?? "", str(fd, "description"), bool(fd, "required")); return "Deliverable added."; });

export const submitDeliverableAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async () => { await submitDeliverable(await requireActor(), str(fd, "deliverableId")!); return "Deliverable submitted."; });

export const commentProjectAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async (id) => { await addProjectComment(await requireActor(), id, str(fd, "body") ?? "", str(fd, "visibility") === "INTERNAL" ? "INTERNAL" : "MDA_VISIBLE", fd.getAll("mentions").map(String)); return "Message posted."; });

export const scopeChangeAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async (id) => { await requestScopeChange(await requireActor(), id, { proposedChange: str(fd, "proposedChange"), reason: str(fd, "reason"), impactAssessment: str(fd, "impactAssessment") || undefined, scheduleImpactDays: str(fd, "scheduleImpactDays") || undefined, resourceImpact: str(fd, "resourceImpact") || undefined }); return "Scope change requested."; });

export const scopeDecisionAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async () => { await decideScopeChange(await requireActor(), str(fd, "scopeChangeId")!, str(fd, "decision") === "APPROVE", str(fd, "reason") ?? ""); return "Decision recorded."; });

export const completionAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async (id) => {
    await submitCompletion(await requireActor(), id, Object.fromEntries(["summary", "deliverablesSummary", "evidenceSummary", "technicalDocumentation", "outstandingIssues", "handoverInformation", "trainingRecords", "maintenanceInstructions", "recommendedNextSteps"].map((k) => [k, str(fd, k) || undefined])));
    return "Submitted for KATDICT completion review.";
  });

export const reviewCompletionAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async (id) => {
    const o = str(fd, "outcome");
    if (!o) throw new AppError("Choose an outcome.");
    await reviewCompletion(await requireActor(), id, o as "APPROVED", str(fd, "notes"));
    return "Review recorded.";
  });

export const acceptanceAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async (id) => { await mdaAcceptanceDecision(await requireActor(), id, { outcome: str(fd, "outcome"), reason: str(fd, "reason") || undefined, rating: str(fd, "rating") || undefined, feedback: str(fd, "feedback") || undefined }); return "Decision recorded. Thank you."; });

export const closeAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async (id) => { await closeProject(await requireActor(), id, { actualOutcome: str(fd, "actualOutcome"), lessonsLearned: str(fd, "lessonsLearned") || undefined, followUpRecommendations: str(fd, "followUpRecommendations") || undefined, exceptional: bool(fd, "exceptional"), justification: str(fd, "justification") || undefined }); return "Project closed and completion report generated."; });

export const regenerateReportAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async (id) => {
    const actor = await requireActor();
    assertCan(actor, "report.generate");
    const p = await loadScopedProject(prisma, actor, id, {});
    if (p.status !== "CLOSED") throw new AppError("Reports are generated for closed projects.");
    await prisma.$transaction((tx) => generateProjectReport(tx, id, actor.id));
    return "A new report version was generated.";
  });

export const suggestPlanAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async (id) => { const r = await suggestProjectPlan(await requireActor(), id); return r.notice ?? "Draft plan generated. Review it below before adopting."; });

export const adoptPlanAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async () => { await adoptProjectPlan(await requireActor(), str(fd, "recommendationId")!); return "Plan adopted as milestones and tasks."; });

export const dismissPlanAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async () => { await dismissRecommendation(await requireActor(), str(fd, "recommendationId")!); return "Draft dismissed."; });

export const feedbackAction = async (_: ActionState, fd: FormData) =>
  wrap(fd, async (id) => {
    const { submitFeedback } = await import("@/modules/feedback/service");
    await submitFeedback(await requireActor(), { projectId: id, rating: str(fd, "rating"), comments: str(fd, "comments") || undefined });
    return "Feedback saved.";
  });
