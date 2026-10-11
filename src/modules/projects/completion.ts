import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { audit } from "@/modules/audit/audit";
import { mdaAdminIds, notify, usersWithPermission } from "@/modules/notifications/service";
import type { Actor } from "@/modules/rbac/actor";
import { assertCan, can } from "@/modules/rbac/authorize";
import { getSetting } from "@/modules/settings/service";
import { generateProjectReport } from "@/modules/reports/project-report";
import { isAssignedToProject, loadScopedProject } from "./access";
import { projectTeamIds, recordProjectStatus } from "./service";

function vErr(e: z.ZodError) {
  return new ValidationError("Please correct the highlighted fields.", e.flatten().fieldErrors as Record<string, string[]>);
}

// ---------------------------------------------------------------------------
// Step 1: officer submits for completion review
// ---------------------------------------------------------------------------

export const completionSchema = z.object({
  summary: z.string().trim().min(20, "Summarise the work performed (min 20 characters)").max(10000),
  deliverablesSummary: z.string().trim().min(10).max(10000),
  evidenceSummary: z.string().trim().max(5000).optional(),
  technicalDocumentation: z.string().trim().max(5000).optional(),
  outstandingIssues: z.string().trim().max(5000).optional(),
  handoverInformation: z.string().trim().max(5000).optional(),
  trainingRecords: z.string().trim().max(5000).optional(),
  maintenanceInstructions: z.string().trim().max(5000).optional(),
  recommendedNextSteps: z.string().trim().max(5000).optional(),
});

export async function submitCompletion(actor: Actor, projectId: string, raw: unknown) {
  assertCan(actor, "project.completion.submit");
  const parsed = completionSchema.safeParse(raw);
  if (!parsed.success) throw vErr(parsed.error);
  const p = await loadScopedProject(prisma, actor, projectId, { milestones: true, deliverables: true });
  if (!(await isAssignedToProject(prisma, actor.id, projectId))) throw new ForbiddenError("Only the assigned project team can submit completion.");
  if (p.status !== "IN_PROGRESS") throw new AppError("Completion can only be submitted while the project is in progress.");
  if (p.milestones.length === 0) throw new AppError("Record at least one milestone before submitting completion.");
  const openMs = p.milestones.filter((m) => !["COMPLETED", "CANCELLED"].includes(m.status));
  if (openMs.length) throw new AppError(`Complete or cancel all milestones first (${openMs.length} open).`);
  const missing = p.deliverables.filter((d) => d.required && !["SUBMITTED", "ACCEPTED"].includes(d.status));
  if (missing.length) throw new AppError(`Submit all required deliverables first: ${missing.map((d) => d.title).join(", ")}.`);

  await prisma.$transaction(async (tx) => {
    const cycle = (await tx.completionSubmission.count({ where: { projectId } })) + 1;
    const res = await tx.project.updateMany({
      where: { id: projectId, status: "IN_PROGRESS" },
      data: { status: "UNDER_REVIEW", acceptanceStatus: "UNDER_KATDICT_REVIEW", completionSubmittedAt: new Date(), version: { increment: 1 } },
    });
    if (res.count !== 1) throw new ConflictError();
    const sub = await tx.completionSubmission.create({ data: { projectId, cycle, submittedById: actor.id, ...parsed.data } });
    // Link previously uploaded completion evidence that is not yet tied to a submission.
    await tx.attachment.updateMany({ where: { projectId, completionSubmissionId: null, category: { in: ["EVIDENCE", "TEST_EVIDENCE", "COMPLETION_REPORT", "HANDOVER", "USER_MANUAL", "TRAINING_MATERIAL"] } }, data: { completionSubmissionId: sub.id } });
    await recordProjectStatus(tx, projectId, "IN_PROGRESS", "UNDER_REVIEW", "submit_completion", actor.id);
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "project.completion_submitted", entityType: "CompletionSubmission", entityId: sub.id, after: { projectId, cycle } });
    const reviewers = new Set(await usersWithPermission(tx, "project.completion.review"));
    for (const t of await projectTeamIds(tx, projectId)) reviewers.delete(t);
    await notify(tx, { userIds: [...reviewers], type: "project.completion_submitted", title: `Completion review needed: ${p.reference}`, body: `${actor.name} submitted "${p.title}" for completion review (cycle ${cycle}).`, link: `/projects/${projectId}?tab=completion` });
  });
}

// ---------------------------------------------------------------------------
// Step 2: KATDICT review
// ---------------------------------------------------------------------------

export type CompletionReviewOutcome = "APPROVED" | "EVIDENCE_REQUESTED" | "RETURNED" | "REJECTED";

export async function reviewCompletion(actor: Actor, projectId: string, outcome: CompletionReviewOutcome, notes: string | undefined) {
  assertCan(actor, "project.completion.review");
  if (!["APPROVED", "EVIDENCE_REQUESTED", "RETURNED", "REJECTED"].includes(outcome)) throw new ValidationError("Invalid outcome.");
  if (outcome !== "APPROVED" && !notes?.trim()) throw new ValidationError("Explain what is required.");
  const p = await loadScopedProject(prisma, actor, projectId, {});
  if (p.status !== "UNDER_REVIEW") throw new AppError("This project is not awaiting completion review.");
  // Separation of duties: the delivery team cannot review its own work.
  if (await isAssignedToProject(prisma, actor.id, projectId)) throw new ForbiddenError("Members of the project team cannot review their own completion submission.");
  const isDeptHead = !!p.departmentId && actor.headOfDepartmentIds.includes(p.departmentId);
  if (!can(actor, "project.read.all") && !isDeptHead) throw new ForbiddenError();
  const sub = await prisma.completionSubmission.findFirst({ where: { projectId, status: "SUBMITTED" }, orderBy: { cycle: "desc" } });
  if (!sub) throw new AppError("No pending completion submission found.");
  if (sub.submittedById === actor.id) throw new ForbiddenError("You cannot review your own submission.");

  const approved = outcome === "APPROVED";
  await prisma.$transaction(async (tx) => {
    const res = await tx.project.updateMany({
      where: { id: projectId, status: "UNDER_REVIEW" },
      data: approved
        ? { status: "AWAITING_MDA_ACCEPTANCE", acceptanceStatus: "AWAITING_MDA", version: { increment: 1 } }
        : { status: "IN_PROGRESS", acceptanceStatus: "RETURNED_FOR_CORRECTION", version: { increment: 1 } },
    });
    if (res.count !== 1) throw new ConflictError();
    await tx.completionSubmission.update({ where: { id: sub.id }, data: { status: outcome, reviewedById: actor.id, reviewedAt: new Date(), reviewNotes: notes?.trim() || null } });
    await recordProjectStatus(tx, projectId, "UNDER_REVIEW", approved ? "AWAITING_MDA_ACCEPTANCE" : "IN_PROGRESS", `completion_review_${outcome.toLowerCase()}`, actor.id, notes);
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: `project.completion_review.${outcome.toLowerCase()}`, entityType: "CompletionSubmission", entityId: sub.id, after: { projectId, outcome }, reason: notes });
    if (approved) {
      await notify(tx, { userIds: await mdaAdminIds(tx, p.mdaId), type: "project.acceptance_requested", title: `Please review and accept: ${p.reference}`, body: `KATDICT has completed its review of "${p.title}". Please confirm acceptance of the deliverables, or report any issues.`, link: `/projects/${projectId}?tab=completion` });
      await notify(tx, { userIds: await projectTeamIds(tx, projectId), type: "project.status_changed", title: `Completion approved by KATDICT: ${p.reference}`, body: "The submission has been sent to the MDA for acceptance.", link: `/projects/${projectId}`, email: false });
    } else {
      await notify(tx, { userIds: await projectTeamIds(tx, projectId), type: "project.completion_returned", title: `Completion review returned: ${p.reference}`, body: `Outcome: ${outcome.replace(/_/g, " ").toLowerCase()}.\n\n${notes}`, link: `/projects/${projectId}?tab=completion` });
    }
  });
}

// ---------------------------------------------------------------------------
// Steps 3–4: MDA acceptance and remediation
// ---------------------------------------------------------------------------

export const acceptanceSchema = z.object({
  outcome: z.enum(["ACCEPTED", "REJECTED", "CLARIFICATION_REQUESTED", "INCOMPLETE_DELIVERABLES"]),
  reason: z.string().trim().max(5000).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  feedback: z.string().trim().max(3000).optional(),
});

export async function mdaAcceptanceDecision(actor: Actor, projectId: string, raw: unknown) {
  assertCan(actor, "project.accept");
  const parsed = acceptanceSchema.safeParse(raw);
  if (!parsed.success) throw vErr(parsed.error);
  const d = parsed.data;
  if (d.outcome !== "ACCEPTED" && !d.reason) throw new ValidationError("Please give reasons.");
  const p = await loadScopedProject(prisma, actor, projectId, {});
  if (actor.userType !== "MDA_USER" || p.mdaId !== actor.mdaId) throw new ForbiddenError("Only the requesting MDA can accept this project.");
  if (p.status !== "AWAITING_MDA_ACCEPTANCE") throw new AppError("This project is not awaiting MDA acceptance.");
  const sub = await prisma.completionSubmission.findFirst({ where: { projectId, status: "APPROVED" }, orderBy: { cycle: "desc" } });
  if (!sub) throw new AppError("No approved completion submission found.");

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.acceptanceDecision.create({ data: { projectId, submissionId: sub.id, decidedById: actor.id, outcome: d.outcome, reason: d.reason ?? null } });
    if (d.outcome === "ACCEPTED") {
      const res = await tx.project.updateMany({ where: { id: projectId, status: "AWAITING_MDA_ACCEPTANCE" }, data: { status: "ACCEPTED", acceptanceStatus: "ACCEPTED", acceptedAt: now, version: { increment: 1 } } });
      if (res.count !== 1) throw new ConflictError();
      await tx.projectDeliverable.updateMany({ where: { projectId, status: "SUBMITTED" }, data: { status: "ACCEPTED" } });
      await recordProjectStatus(tx, projectId, "AWAITING_MDA_ACCEPTANCE", "ACCEPTED", "mda_accept", actor.id, d.reason);
      if (d.rating) {
        await tx.feedback.upsert({
          where: { projectId_userId: { projectId, userId: actor.id } },
          create: { projectId, mdaId: p.mdaId, userId: actor.id, rating: d.rating, comments: d.feedback ?? null },
          update: { rating: d.rating, comments: d.feedback ?? null },
        });
      }
      await notify(tx, { userIds: [...(await projectTeamIds(tx, projectId)), ...(await usersWithPermission(tx, "project.close"))], type: "project.acceptance_confirmed", title: `MDA accepted: ${p.reference}`, body: `${actor.mdaName ?? "The MDA"} accepted the deliverables of "${p.title}". The project can now be closed.`, link: `/projects/${projectId}?tab=completion` });
    } else if (d.outcome === "CLARIFICATION_REQUESTED") {
      await tx.projectComment.create({ data: { projectId, authorId: actor.id, body: `Clarification requested before acceptance: ${d.reason}`, visibility: "MDA_VISIBLE", kind: "CLARIFICATION_REQUEST" } });
      await notify(tx, { userIds: await projectTeamIds(tx, projectId), type: "project.acceptance_disputed", title: `MDA requests clarification: ${p.reference}`, body: d.reason!, link: `/projects/${projectId}?tab=communications` });
    } else {
      // Remediation: return to IN_PROGRESS; original submission and feedback are preserved.
      const res = await tx.project.updateMany({ where: { id: projectId, status: "AWAITING_MDA_ACCEPTANCE" }, data: { status: "IN_PROGRESS", acceptanceStatus: "DISPUTED", remediationCount: { increment: 1 }, version: { increment: 1 } } });
      if (res.count !== 1) throw new ConflictError();
      await recordProjectStatus(tx, projectId, "AWAITING_MDA_ACCEPTANCE", "IN_PROGRESS", `mda_${d.outcome.toLowerCase()}`, actor.id, d.reason);
      await notify(tx, { userIds: [...(await projectTeamIds(tx, projectId)), ...(await usersWithPermission(tx, "project.assign"))], type: "project.acceptance_disputed", title: `MDA disputed completion: ${p.reference}`, body: `${d.outcome === "REJECTED" ? "Acceptance rejected" : "Incomplete deliverables reported"}: ${d.reason}`, link: `/projects/${projectId}?tab=completion` });
    }
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: `project.acceptance.${d.outcome.toLowerCase()}`, entityType: "Project", entityId: projectId, before: { status: "AWAITING_MDA_ACCEPTANCE" }, after: { outcome: d.outcome, rating: d.rating }, reason: d.reason });
  });
}

// ---------------------------------------------------------------------------
// Step 5: closure
// ---------------------------------------------------------------------------

export const closureSchema = z.object({
  actualOutcome: z.string().trim().min(10).max(10000),
  lessonsLearned: z.string().trim().max(10000).optional(),
  followUpRecommendations: z.string().trim().max(10000).optional(),
  exceptional: z.coerce.boolean().default(false),
  justification: z.string().trim().max(5000).optional(),
});

export async function closeProject(actor: Actor, projectId: string, raw: unknown) {
  const parsed = closureSchema.safeParse(raw);
  if (!parsed.success) throw vErr(parsed.error);
  const c = parsed.data;
  const p = await loadScopedProject(prisma, actor, projectId, { deliverables: true });
  if (actor.userType !== "KATDICT_STAFF") throw new ForbiddenError();
  if (c.exceptional) {
    assertCan(actor, "project.close.exceptional");
    if (!c.justification || c.justification.length < 20) throw new ValidationError("Exceptional closure requires a detailed justification (min 20 characters).");
    if (["CLOSED", "CANCELLED", "APPROVED", "PLANNING", "ASSIGNED", "AWAITING_ACKNOWLEDGMENT"].includes(p.status)) throw new AppError("Exceptional closure is not available in the current status.");
  } else {
    assertCan(actor, "project.close");
    if (p.status !== "ACCEPTED" || p.acceptanceStatus !== "ACCEPTED") throw new AppError("Projects can only be closed after MDA acceptance. Use exceptional closure if formally authorised.");
    if (await getSetting("workflow.requireAllDeliverablesForClosure")) {
      const pending = p.deliverables.filter((d) => d.required && d.status !== "ACCEPTED");
      if (pending.length) throw new AppError(`Required deliverables are not accepted: ${pending.map((d) => d.title).join(", ")}.`);
    }
    if (await isAssignedToProject(prisma, actor.id, projectId)) throw new ForbiddenError("The delivery team cannot close its own project; another authorised officer must close it.");
  }

  await prisma.$transaction(
    async (tx) => {
      const now = new Date();
      const res = await tx.project.updateMany({ where: { id: projectId, status: p.status }, data: { status: "CLOSED", closedAt: now, actualEndDate: now, version: { increment: 1 } } });
      if (res.count !== 1) throw new ConflictError();
      await tx.projectClosure.create({
        data: {
          projectId, closedById: actor.id, closureType: c.exceptional ? "EXCEPTIONAL" : "STANDARD", justification: c.justification ?? null,
          actualOutcome: c.actualOutcome, lessonsLearned: c.lessonsLearned ?? null, followUpRecommendations: c.followUpRecommendations ?? null,
        },
      });
      await recordProjectStatus(tx, projectId, p.status, "CLOSED", c.exceptional ? "close_exceptional" : "close", actor.id, c.justification);
      await audit(tx, {
        actorId: actor.id, actorEmail: actor.email, action: c.exceptional ? "project.closed_exceptional" : "project.closed", entityType: "Project", entityId: projectId,
        before: { status: p.status }, after: { status: "CLOSED", closureType: c.exceptional ? "EXCEPTIONAL" : "STANDARD" }, reason: c.justification,
      });
      // Institutional memory: lessons learned become a draft knowledge document for approval.
      if (c.lessonsLearned) {
        await tx.knowledgeDocument.create({
          data: {
            title: `Lessons learned: ${p.title}`, summary: c.actualOutcome.slice(0, 500), body: `Lessons learned\n\n${c.lessonsLearned}${c.followUpRecommendations ? `\n\nFollow-up recommendations\n\n${c.followUpRecommendations}` : ""}`,
            category: "LESSON_LEARNED", projectId, mdaId: p.mdaId, authorId: actor.id, status: "DRAFT", visibility: "KATDICT_ONLY", tags: ["lessons-learned"],
          },
        });
      }
      await generateProjectReport(tx, projectId, actor.id);
      await notify(tx, {
        userIds: [...(await projectTeamIds(tx, projectId)), ...(await mdaAdminIds(tx, p.mdaId))], type: "project.closed",
        title: `Project closed: ${p.reference}`, body: `"${p.title}" has been formally closed. The completion report is available in the project record.`, link: `/projects/${projectId}?tab=report`,
      });
    },
    { timeout: 30_000 },
  );
}
