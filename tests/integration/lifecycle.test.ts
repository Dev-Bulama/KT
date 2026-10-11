import { beforeAll, describe, expect, it } from "vitest";
import { prisma, resetDb, makeMda, makeUser, serviceId, fullRequest, version, pversion } from "./helpers";
import type { Actor } from "@/modules/rbac/actor";
import { createDraft, submitRequest, transitionRequest, recordAssessment, decideApproval } from "@/modules/requests/service";
import { initiateProject, transitionProject } from "@/modules/projects/service";
import { assignProject, acknowledgeAssignment } from "@/modules/projects/assignments";
import { createMilestone, createTask, setTaskStatus, setMilestoneStatus, submitDeliverable } from "@/modules/projects/delivery";
import { submitCompletion, reviewCompletion, mdaAcceptanceDecision, closeProject } from "@/modules/projects/completion";
import { uploadFile } from "@/modules/files/service";
import { processOutbox } from "@/modules/notifications/service";
import { setEmailProvider } from "@/modules/notifications/email";
import { verifyAuditChain } from "@/modules/audit/audit";
import type { ProjectReportData } from "@/modules/reports/project-report";

const PDF = new TextEncoder().encode("%PDF-1.4\n%test\n");

describe("end-to-end request → project → closure (service layer)", () => {
  let mdaAdmin: Actor, ops: Actor, ops2: Actor, head: Actor, director: Actor, officer: Actor;
  let requestId = "";
  let projectId = "";

  beforeAll(async () => {
    await resetDb();
    const mda = await makeMda("LIFE");
    mdaAdmin = await makeUser("MDA_ADMIN", { mdaId: mda.id });
    ops = await makeUser("OPERATIONS_ADMIN");
    ops2 = await makeUser("OPERATIONS_ADMIN");
    head = await makeUser("DEPARTMENT_HEAD", { departmentCode: "SWD" });
    director = await makeUser("DIRECTOR");
    officer = await makeUser("PROJECT_OFFICER", { departmentCode: "SWD", skills: ["web"] });
  });

  it("MDA submits a request with a unique reference, history, audit and notifications", async () => {
    const d = await createDraft(mdaAdmin, fullRequest(await serviceId()));
    const key = "lifecycle-key-0000000001";
    const r = await submitRequest(mdaAdmin, d.id, key);
    requestId = r.id;
    expect(r.status).toBe("SUBMITTED");
    expect(r.reference).toMatch(/^KATDICT-REQ-\d{4}-00001$/);
    // Duplicate click with the same key returns the same request, no second reference.
    const again = await submitRequest(mdaAdmin, d.id, key);
    expect(again.id).toBe(r.id);
    expect(await prisma.serviceRequest.count({ where: { reference: { not: null } } })).toBe(1);
    expect(await prisma.requestStatusHistory.count({ where: { requestId } })).toBe(2);
    expect(await prisma.auditEvent.count({ where: { entityId: requestId, action: "request.submitted" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: ops.id, type: "request.submitted" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: mdaAdmin.id, type: "request.submission_confirmation" } })).toBe(1);
  });

  it("KATDICT triages, assesses (with a clarification loop) and scopes", async () => {
    const swd = await prisma.department.findUniqueOrThrow({ where: { code: "SWD" } });
    await transitionRequest(ops, requestId, "start_triage", {}, await version(requestId));
    await transitionRequest(ops, requestId, "accept_for_assessment", { triage: { priority: "HIGH", assignedDepartmentId: swd.id, assessorId: ops.id } }, await version(requestId));
    await transitionRequest(ops, requestId, "request_information", { reason: "Please attach the registry workflow." }, await version(requestId));
    await transitionRequest(mdaAdmin, requestId, "mda_respond", { reason: "Workflow described in the attached note." }, await version(requestId));
    await recordAssessment(ops, requestId, { stage: "ASSESSMENT", findings: "Clear and within mandate." });
    await transitionRequest(ops, requestId, "send_to_technical_evaluation", {}, await version(requestId));
    await recordAssessment(head, requestId, { stage: "TECHNICAL", findings: "Feasible on standard stack." });
    await transitionRequest(head, requestId, "complete_technical_evaluation", {}, await version(requestId));
    await recordAssessment(ops, requestId, { stage: "SCOPE", findings: "Scope agreed with the MDA", proposedScope: "Build and deploy registry", estimatedEffortDays: 30, estimatedCostNgn: 5_000_000 });
    await transitionRequest(ops, requestId, "submit_for_approval", {}, await version(requestId));
    const r = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(r.status).toBe("APPROVAL_REVIEW");
    expect(await prisma.requestComment.count({ where: { requestId, kind: { in: ["CLARIFICATION_REQUEST", "CLARIFICATION_RESPONSE"] } } })).toBe(2);
  });

  it("approval follows the policy: technical, departmental, and executive for HIGH priority", async () => {
    await expect(decideApproval(ops, requestId, "APPROVED", undefined, await version(requestId))).rejects.toThrow(/scope cannot approve/);
    await decideApproval(ops2, requestId, "APPROVED", "ok", await version(requestId));
    await expect(decideApproval(ops2, requestId, "APPROVED", "again", await version(requestId))).rejects.toThrow();
    await decideApproval(head, requestId, "APPROVED", "ok", await version(requestId));
    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("APPROVAL_REVIEW");
    await decideApproval(director, requestId, "APPROVED", "ok", await version(requestId));
    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("APPROVED");
  });

  it("project is initiated, assigned and acknowledged", async () => {
    const p = await initiateProject(ops, requestId, await version(requestId));
    projectId = p.id;
    expect(p.reference).toMatch(/^KATDICT-PRJ-\d{4}-00001$/);
    expect(await prisma.projectDeliverable.count({ where: { projectId } })).toBeGreaterThan(0);
    await transitionProject(ops, projectId, "start_planning", undefined, await pversion(projectId));
    await assignProject(ops, projectId, { projectManagerId: officer.id, instructions: "Deliver per scope", expectedOutcomes: "Accepted system", plannedEndDate: new Date(Date.now() + 30 * 86400000) }, await pversion(projectId));
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe("AWAITING_ACKNOWLEDGMENT");
    await expect(transitionProject(officer, projectId, "start_work", undefined, await pversion(projectId))).rejects.toThrow();
    const a = await prisma.projectAssignment.findFirstOrThrow({ where: { projectId, assigneeId: officer.id } });
    await acknowledgeAssignment(officer, a.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe("ASSIGNED");
    await transitionProject(officer, projectId, "start_work", undefined, await pversion(projectId));
    expect(await prisma.outboxEvent.count({ where: { payload: { path: ["subject"], string_contains: "New assignment" } } })).toBe(1);
  });

  it("officer updates milestones; progress is derived, not typed", async () => {
    await createMilestone(officer, projectId, { title: "Build", weight: 2, dueDate: new Date(Date.now() + 10 * 86400000) });
    const m = await prisma.projectMilestone.findFirstOrThrow({ where: { projectId } });
    await createTask(officer, projectId, { title: "Develop", milestoneId: m.id, assigneeId: officer.id });
    await createTask(officer, projectId, { title: "Test", milestoneId: m.id });
    const [t1, t2] = await prisma.projectTask.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
    await setTaskStatus(officer, t1.id, "DONE");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).progressPercent).toBe(50);
    await expect(setMilestoneStatus(officer, m.id, "COMPLETED")).rejects.toThrow(/open task/);
    await setTaskStatus(officer, t2.id, "DONE");
    await setMilestoneStatus(officer, m.id, "COMPLETED");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).progressPercent).toBe(100);
    expect(await prisma.auditEvent.count({ where: { entityId: projectId, action: "project.progress_updated" } })).toBeGreaterThan(0);
  });

  it("completion requires evidence; KATDICT reviews; MDA disputes then accepts", async () => {
    await expect(submitCompletion(officer, projectId, { summary: "Delivered the registry system to the MDA.", deliverablesSummary: "All delivered" })).rejects.toThrow(/deliverables/);
    for (const d of await prisma.projectDeliverable.findMany({ where: { projectId } })) {
      await uploadFile(officer, { name: `${d.title}.pdf`, bytes: PDF }, { deliverableId: d.id, category: "DELIVERABLE", visibility: "MDA_VISIBLE" });
      await submitDeliverable(officer, d.id);
    }
    await submitCompletion(officer, projectId, { summary: "Delivered the registry system to the MDA.", deliverablesSummary: "All delivered" });
    await expect(reviewCompletion(officer, projectId, "APPROVED", undefined)).rejects.toThrow();
    await reviewCompletion(ops2, projectId, "APPROVED", undefined);
    await mdaAcceptanceDecision(mdaAdmin, projectId, { outcome: "INCOMPLETE_DELIVERABLES", reason: "Training not done" });
    let p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(p.status).toBe("IN_PROGRESS");
    expect(p.acceptanceStatus).toBe("DISPUTED");
    expect(p.remediationCount).toBe(1);
    await submitCompletion(officer, projectId, { summary: "Training completed for 20 staff; registry live.", deliverablesSummary: "All delivered + training" });
    await reviewCompletion(ops2, projectId, "APPROVED", undefined);
    await mdaAcceptanceDecision(mdaAdmin, projectId, { outcome: "ACCEPTED", rating: 4 });
    p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(p.status).toBe("ACCEPTED");
    expect(await prisma.completionSubmission.count({ where: { projectId } })).toBe(2); // original preserved
  });

  it("closure is done by someone outside the team and generates the report", async () => {
    await expect(closeProject(officer, projectId, { actualOutcome: "Registry live and in use." })).rejects.toThrow();
    await closeProject(ops2, projectId, { actualOutcome: "Registry live and in use.", lessonsLearned: "Train early." });
    const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { reports: true, closure: true } });
    expect(p.status).toBe("CLOSED");
    expect(p.reports).toHaveLength(1);
    const data = p.reports[0].data as unknown as ProjectReportData;
    expect(data.identification.projectReference).toBe(p.reference);
    expect(data.performance.reviewCycles).toBe(2);
    expect(data.performance.remediationCycles).toBe(1);
    expect(data.accountability.approvedBy).toHaveLength(3);
    expect(data.accountability.closedBy?.name).toBe(ops2.name);
    expect(data.outcomes.mdaRating).toBe(4);
    expect(await prisma.knowledgeDocument.count({ where: { projectId, status: "DRAFT" } })).toBe(1);
  });

  it("audit history contains the key actions and the hash chain verifies", async () => {
    const actions = (await prisma.auditEvent.findMany({ select: { action: true } })).map((a) => a.action);
    for (const a of ["request.submitted", "request.start_triage", "request.approval.approved", "project.initiated", "project.assigned", "project.assignment_acknowledged", "project.completion_submitted", "project.acceptance.accepted", "project.closed", "report.generated"]) {
      expect(actions, a).toContain(a);
    }
    const chain = await verifyAuditChain();
    expect(chain.ok).toBe(true);
    await expect(prisma.$executeRawUnsafe(`UPDATE "AuditEvent" SET action='tampered' WHERE id=1`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE id=1`)).rejects.toThrow(/append-only/);
  });

  it("queued emails are delivered by the outbox with retries", async () => {
    const sent: string[] = [];
    let fail = true;
    setEmailProvider({ name: "test", send: async (m) => { if (fail) { fail = false; throw new Error("provider down"); } sent.push(m.to); return { id: "x" }; } });
    const r1 = await processOutbox(500);
    expect(r1.failed).toBe(1);
    const failed = await prisma.outboxEvent.findFirstOrThrow({ where: { status: "FAILED" } });
    expect(failed.lastError).toMatch(/provider down/);
    await prisma.outboxEvent.update({ where: { id: failed.id }, data: { nextAttemptAt: new Date() } });
    await processOutbox(500);
    expect(await prisma.outboxEvent.count({ where: { status: { in: ["PENDING", "FAILED"] } } })).toBe(0);
    expect(sent.length).toBeGreaterThan(5);
    setEmailProvider(null);
  });
});
