import { beforeAll, describe, expect, it } from "vitest";
import { prisma, resetDb, makeMda, makeUser, serviceId, fullRequest, version, pversion } from "./helpers";
import type { Actor } from "@/modules/rbac/actor";
import { addRequestComment, createDraft, decideApproval, getRequest, listRequests, recordAssessment, submitRequest, transitionRequest, updateDraft } from "@/modules/requests/service";
import { getProject, initiateProject, listProjects, transitionProject } from "@/modules/projects/service";
import { assignProject } from "@/modules/projects/assignments";
import { addProjectComment, createMilestone, listProjectComments } from "@/modules/projects/delivery";
import { closeProject, mdaAcceptanceDecision, reviewCompletion, submitCompletion } from "@/modules/projects/completion";
import { setRolePermissions, setUserRoles, setUserStatus } from "@/modules/admin/users";
import { createInvitation, getMda, reviewMda, updateMdaProfile } from "@/modules/mdas/service";
import { askAnalytics, askAssistant, classifyRequest, executiveBriefing } from "@/modules/ai/features";
import { globalSearch } from "@/modules/search/service";
import { authoriseDownload, uploadFile } from "@/modules/files/service";
import { updateSetting } from "@/modules/settings/service";

describe("authorization", () => {
  let mdaA: Actor, mdaAStaff: Actor, mdaB: Actor, ops: Actor, ops2: Actor, head: Actor, director: Actor, officer: Actor, otherOfficer: Actor, auditor: Actor, superAdmin: Actor;
  let reqA = "", reqB = "", projA = "", mdaBId = "";

  beforeAll(async () => {
    await resetDb();
    const a = await makeMda("AAA");
    const b = await makeMda("BBB");
    mdaBId = b.id;
    mdaA = await makeUser("MDA_ADMIN", { mdaId: a.id });
    mdaAStaff = await makeUser("MDA_STAFF", { mdaId: a.id });
    mdaB = await makeUser("MDA_ADMIN", { mdaId: b.id });
    ops = await makeUser("OPERATIONS_ADMIN");
    ops2 = await makeUser("OPERATIONS_ADMIN");
    head = await makeUser("DEPARTMENT_HEAD", { departmentCode: "SWD" });
    director = await makeUser("DIRECTOR");
    officer = await makeUser("PROJECT_OFFICER", { departmentCode: "SWD" });
    otherOfficer = await makeUser("PROJECT_OFFICER", { departmentCode: "INF" });
    auditor = await makeUser("AUDITOR");
    superAdmin = await makeUser("SUPER_ADMIN");
    const svc = await serviceId();
    const dA = await createDraft(mdaA, fullRequest(svc, "MDA A confidential request"));
    reqA = (await submitRequest(mdaA, dA.id, "authz-key-a-000000001")).id;
    const dB = await createDraft(mdaB, fullRequest(svc, "MDA B confidential request"));
    reqB = (await submitRequest(mdaB, dB.id, "authz-key-b-000000001")).id;
    // Take request A all the way to an in-progress project assigned to `officer`.
    const swd = await prisma.department.findUniqueOrThrow({ where: { code: "SWD" } });
    await transitionRequest(ops, reqA, "start_triage", {}, await version(reqA));
    await transitionRequest(ops, reqA, "accept_for_assessment", { triage: { priority: "MEDIUM", assignedDepartmentId: swd.id } }, await version(reqA));
    await recordAssessment(ops, reqA, { stage: "ASSESSMENT", findings: "Within mandate and clear." });
    await transitionRequest(ops, reqA, "send_to_technical_evaluation", {}, await version(reqA));
    await recordAssessment(head, reqA, { stage: "TECHNICAL", findings: "Technically feasible." });
    await transitionRequest(head, reqA, "complete_technical_evaluation", {}, await version(reqA));
    await recordAssessment(ops, reqA, { stage: "SCOPE", findings: "Scope agreed with MDA.", proposedScope: "Build it", estimatedEffortDays: 10 });
    await transitionRequest(ops, reqA, "submit_for_approval", {}, await version(reqA));
  });

  describe("MDA isolation", () => {
    it("MDA A cannot read MDA B's request, by id or in lists", async () => {
      await expect(getRequest(mdaA, reqB)).rejects.toThrow(/not found/i);
      const list = await listRequests(mdaA);
      expect(list.items.map((r) => r.id)).toEqual([reqA]);
    });
    it("MDA B cannot comment on, transition or view MDA A's MDA record", async () => {
      await expect(addRequestComment(mdaB, reqA, "hello", "MDA_VISIBLE")).rejects.toThrow(/not found/i);
      await expect(transitionRequest(mdaB, reqA, "withdraw", { reason: "x" }, 0)).rejects.toThrow();
      await expect(getMda(mdaB, (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: reqA } })).mdaId)).rejects.toThrow(/not found/i);
    });
    it("MDA staff only see their own requests", async () => {
      expect((await listRequests(mdaAStaff)).items).toHaveLength(0);
    });
    it("a user cannot move a request to another MDA (mass assignment)", async () => {
      const d = await createDraft(mdaA, { ...fullRequest(await serviceId()), mdaId: mdaBId, createdById: mdaB.id, status: "APPROVED", priority: "CRITICAL" } as never);
      const row = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.mdaId).not.toBe(mdaBId);
      expect(row.status).toBe("DRAFT");
      expect(row.priority).toBeNull();
      await updateDraft(mdaA, d.id, { ...fullRequest(await serviceId()), mdaId: mdaBId } as never, row.version);
      expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: d.id } })).mdaId).toBe(row.mdaId);
    });
    it("MDA admins cannot edit another MDA's profile or invite users to it", async () => {
      await expect(updateMdaProfile(mdaB, (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: reqA } })).mdaId, {}, 0)).rejects.toThrow(/not authorised/i);
      await expect(createInvitation(mdaB, { email: "x@test.invalid", roleKeys: ["MDA_STAFF"], mdaId: (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: reqA } })).mdaId })).rejects.toThrow(/own MDA/);
    });
  });

  describe("approvals and privilege", () => {
    it("unauthorised users cannot approve a request", async () => {
      await expect(decideApproval(mdaA, reqA, "APPROVED", undefined, await version(reqA))).rejects.toThrow();
      await expect(decideApproval(officer, reqA, "APPROVED", undefined, await version(reqA))).rejects.toThrow();
      await expect(decideApproval(auditor, reqA, "APPROVED", undefined, await version(reqA))).rejects.toThrow();
      // Director cannot skip the technical step.
      await expect(decideApproval(director, reqA, "APPROVED", undefined, await version(reqA))).rejects.toThrow(/different approval authority/);
    });
    it("stale versions are rejected (concurrent update protection)", async () => {
      await expect(decideApproval(ops2, reqA, "APPROVED", undefined, (await version(reqA)) - 1)).rejects.toThrow(/changed by someone else/);
    });
    it("a user cannot grant themselves administrative privileges", async () => {
      await expect(setUserRoles(ops, ops.id, ["SUPER_ADMIN"])).rejects.toThrow();
      await expect(setUserRoles(superAdmin, superAdmin.id, ["SUPER_ADMIN", "DIRECTOR"])).rejects.toThrow(/own roles/);
      const opsRole = await prisma.role.findUniqueOrThrow({ where: { key: "OPERATIONS_ADMIN" } });
      await expect(setRolePermissions(ops, opsRole.id, ["role.manage"])).rejects.toThrow();
      const superRole = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
      await expect(setRolePermissions(superAdmin, superRole.id, [])).rejects.toThrow(/role you hold/);
      await expect(setUserRoles(mdaA, mdaAStaff.id, ["MDA_ADMIN"])).rejects.toThrow();
      await expect(setUserStatus(director, superAdmin.id, "SUSPENDED", "x")).rejects.toThrow();
      await expect(updateSetting(ops, "security.requireMfaForPrivileged", false)).rejects.toThrow();
    });
    it("roles of one user type cannot be granted to another", async () => {
      await expect(setUserRoles(superAdmin, mdaA.id, ["SUPER_ADMIN"])).rejects.toThrow();
      const mdaRole = await prisma.role.findUniqueOrThrow({ where: { key: "MDA_ADMIN" } });
      await expect(setRolePermissions(superAdmin, mdaRole.id, ["request.approve.executive"])).rejects.toThrow(/KATDICT permissions/);
    });
    it("MDA registration review requires mda.review", async () => {
      const pending = await makeMda("PND", "PENDING_REVIEW");
      await expect(reviewMda(officer, pending.id, "APPROVE", undefined, 0)).rejects.toThrow();
      await expect(reviewMda(mdaA, pending.id, "APPROVE", undefined, 0)).rejects.toThrow();
    });
  });

  describe("projects", () => {
    beforeAll(async () => {
      await decideApproval(ops2, reqA, "APPROVED", "ok", await version(reqA));
      await decideApproval(head, reqA, "APPROVED", "ok", await version(reqA));
      projA = (await initiateProject(ops, reqA, await version(reqA))).id;
      await assignProject(ops, projA, { projectManagerId: officer.id, instructions: "Deliver it", expectedOutcomes: "Accepted system" }, await pversion(projA));
    });
    it("an officer cannot access projects they are not assigned to", async () => {
      await expect(getProject(otherOfficer, projA)).rejects.toThrow(/not found/i);
      expect((await listProjects(otherOfficer)).items).toHaveLength(0);
      await expect(createMilestone(otherOfficer, projA, { title: "Sneaky milestone" })).rejects.toThrow();
    });
    it("an officer cannot change assignments or close the project", async () => {
      await expect(assignProject(officer, projA, { projectManagerId: officer.id, instructions: "self", expectedOutcomes: "self" }, await pversion(projA))).rejects.toThrow();
      await expect(transitionProject(officer, projA, "cancel", "x", await pversion(projA))).rejects.toThrow();
      await expect(closeProject(officer, projA, { actualOutcome: "Done done done" })).rejects.toThrow();
      await expect(closeProject(officer, projA, { actualOutcome: "Done done done", exceptional: true, justification: "I want to close this now please" })).rejects.toThrow();
    });
    it("an officer cannot bypass review and acceptance", async () => {
      await expect(submitCompletion(officer, projA, { summary: "Done all of the work required.", deliverablesSummary: "Everything" })).rejects.toThrow(/in progress/);
      await expect(reviewCompletion(officer, projA, "APPROVED", undefined)).rejects.toThrow();
      await expect(mdaAcceptanceDecision(officer, projA, { outcome: "ACCEPTED" })).rejects.toThrow();
      await expect(closeProject(ops, projA, { actualOutcome: "Closing without acceptance" })).rejects.toThrow(/after MDA acceptance/);
    });
    it("only the requesting MDA can accept", async () => {
      await expect(mdaAcceptanceDecision(mdaB, projA, { outcome: "ACCEPTED" })).rejects.toThrow();
    });
    it("internal notes are never visible to MDA users", async () => {
      await addProjectComment(officer, projA, "Internal: vendor quote is high", "INTERNAL");
      await addProjectComment(officer, projA, "Hello MDA, kickoff next week", "MDA_VISIBLE");
      await expect(addProjectComment(mdaA, projA, "Trying to post internal", "INTERNAL")).resolves.toBeUndefined();
      const forMda = await listProjectComments(mdaA, projA);
      expect(forMda.every((c) => c.visibility === "MDA_VISIBLE")).toBe(true);
      expect(forMda.some((c) => c.body.includes("vendor quote"))).toBe(false);
      const { project } = await getProject(mdaA, projA);
      expect(project.tasks).toEqual([]);
      expect(project.risks).toEqual([]);
    });
  });

  describe("auditor (read-only)", () => {
    it("can read but cannot modify protected records", async () => {
      expect((await listRequests(auditor)).items.length).toBeGreaterThanOrEqual(2);
      await expect(getProject(auditor, projA)).resolves.toBeTruthy();
      await expect(transitionRequest(auditor, reqB, "start_triage", {}, await version(reqB))).rejects.toThrow();
      await expect(addRequestComment(auditor, reqB, "note", "INTERNAL")).rejects.toThrow();
      await expect(addProjectComment(auditor, projA, "note", "INTERNAL")).rejects.toThrow();
      await expect(createMilestone(auditor, projA, { title: "Auditor milestone" })).rejects.toThrow();
      await expect(uploadFile(auditor, { name: "x.pdf", bytes: new TextEncoder().encode("%PDF-1.4") }, { projectId: projA, category: "OTHER", visibility: "INTERNAL" })).rejects.toThrow(/read-only/);
    });
  });

  describe("AI and search respect permissions", () => {
    it("AI classification cannot be run on records outside the user's scope", async () => {
      await expect(classifyRequest(mdaA, reqB)).rejects.toThrow();
      await expect(classifyRequest(otherOfficer, reqA)).rejects.toThrow();
    });
    it("the assistant does not retrieve records outside the user's permissions", async () => {
      const r = await askAssistant(mdaA, "What is the status of my request?", { requestId: reqB });
      const ref = (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: reqB } })).reference!;
      expect(JSON.stringify(r.data)).not.toContain(ref);
      expect(JSON.stringify(r.data)).not.toContain("MDA B confidential");
    });
    it("NL analytics and briefings are permission-gated and scoped", async () => {
      await expect(askAnalytics(mdaA, "Which projects are overdue this month?")).rejects.toThrow();
      await expect(executiveBriefing(officer)).rejects.toThrow();
      const res = await askAnalytics(director, "Which MDAs have the highest number of unresolved ICT requests?");
      expect(res.plan.function).toBe("mdas_unresolved_requests");
      expect(res.source).toBe("rules");
    });
    it("global search filters results by permission", async () => {
      const hits = await globalSearch(mdaA, "confidential");
      expect(hits.some((h) => h.title.includes("MDA B"))).toBe(false);
      expect(hits.some((h) => h.title.includes("MDA A"))).toBe(true);
    });
  });

  describe("files", () => {
    it("rejects disguised executables and enforces download authorisation", async () => {
      await expect(uploadFile(officer, { name: "report.pdf", bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0]) }, { projectId: projA, category: "EVIDENCE", visibility: "MDA_VISIBLE" })).rejects.toThrow(/not permitted/);
      const internal = await uploadFile(officer, { name: "internal.pdf", bytes: new TextEncoder().encode("%PDF-1.4 internal") }, { projectId: projA, category: "EVIDENCE", visibility: "INTERNAL" });
      expect(internal.storageKey).not.toContain("internal"); // randomised key
      await expect(authoriseDownload(mdaA, internal.id)).rejects.toThrow(/not found/i);
      await expect(authoriseDownload(mdaB, internal.id)).rejects.toThrow(/not found/i);
      await expect(authoriseDownload(officer, internal.id)).resolves.toBeTruthy();
      const shared = await uploadFile(officer, { name: "shared.pdf", bytes: new TextEncoder().encode("%PDF-1.4 shared") }, { projectId: projA, category: "EVIDENCE", visibility: "MDA_VISIBLE" });
      await expect(authoriseDownload(mdaA, shared.id)).resolves.toBeTruthy();
      await expect(authoriseDownload(mdaB, shared.id)).rejects.toThrow(/not found/i);
    });
  });
});
