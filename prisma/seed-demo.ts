/**
 * FICTIONAL DEMONSTRATION DATA. Every MDA is prefixed "DEMO" and every
 * account uses the reserved ".test" domain. Do not load into production.
 *
 * Records are created through the real domain services so that status
 * histories, audit events, notifications and reports are consistent.
 */
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/modules/auth/password";
import { loadActor, type Actor } from "../src/modules/rbac/actor";
import { createDraft, submitRequest, transitionRequest, recordAssessment, decideApproval } from "../src/modules/requests/service";
import { initiateProject } from "../src/modules/projects/service";
import { assignProject, acknowledgeAssignment } from "../src/modules/projects/assignments";
import { createMilestone, createTask, setTaskStatus, setMilestoneStatus, addRisk, submitDeliverable, addProjectComment, raiseBlocker } from "../src/modules/projects/delivery";
import { submitCompletion, reviewCompletion, mdaAcceptanceDecision, closeProject } from "../src/modules/projects/completion";
import { transitionProject } from "../src/modules/projects/service";
import { uploadFile } from "../src/modules/files/service";
import { saveKnowledgeDoc, setKnowledgeStatus } from "../src/modules/knowledge/service";

export const DEMO_PASSWORD = "Demo-Passw0rd-2026";

const demoUsers = [
  { key: "super", email: "superadmin@demo.katdict.test", name: "Demo Super Administrator", type: "KATDICT_STAFF", roles: ["SUPER_ADMIN"] },
  { key: "director", email: "director@demo.katdict.test", name: "Demo Director-General", type: "KATDICT_STAFF", roles: ["DIRECTOR"] },
  { key: "ops", email: "operations@demo.katdict.test", name: "Demo Operations Admin", type: "KATDICT_STAFF", roles: ["OPERATIONS_ADMIN"] },
  { key: "ops2", email: "operations2@demo.katdict.test", name: "Demo Technical Reviewer", type: "KATDICT_STAFF", roles: ["OPERATIONS_ADMIN"] },
  { key: "head", email: "head.software@demo.katdict.test", name: "Demo Head of Software", type: "KATDICT_STAFF", roles: ["DEPARTMENT_HEAD"], dept: "SWD" },
  { key: "headInf", email: "head.infra@demo.katdict.test", name: "Demo Head of Infrastructure", type: "KATDICT_STAFF", roles: ["DEPARTMENT_HEAD"], dept: "INF" },
  { key: "officer1", email: "officer1@demo.katdict.test", name: "Demo Officer Amina", type: "KATDICT_STAFF", roles: ["PROJECT_OFFICER"], dept: "SWD", skills: ["software", "web", "application", "database", "inventory"] },
  { key: "officer2", email: "officer2@demo.katdict.test", name: "Demo Officer Musa", type: "KATDICT_STAFF", roles: ["PROJECT_OFFICER"], dept: "SWD", skills: ["mobile", "integration", "portal"] },
  { key: "officer3", email: "officer3@demo.katdict.test", name: "Demo Officer Zainab", type: "KATDICT_STAFF", roles: ["PROJECT_OFFICER"], dept: "INF", skills: ["network", "connectivity", "hardware"] },
  { key: "auditor", email: "auditor@demo.katdict.test", name: "Demo Auditor", type: "OVERSIGHT", roles: ["AUDITOR"] },
  { key: "mda1", email: "admin@demo-mes.katdict.test", name: "Demo MES Administrator", type: "MDA_USER", roles: ["MDA_ADMIN"], mda: "DEMO-MES" },
  { key: "mda1staff", email: "staff@demo-mes.katdict.test", name: "Demo MES Staff", type: "MDA_USER", roles: ["MDA_STAFF"], mda: "DEMO-MES" },
  { key: "mda2", email: "admin@demo-asr.katdict.test", name: "Demo ASR Administrator", type: "MDA_USER", roles: ["MDA_ADMIN"], mda: "DEMO-ASR" },
  { key: "mda3", email: "admin@demo-bil.katdict.test", name: "Demo BIL Administrator", type: "MDA_USER", roles: ["MDA_ADMIN"], mda: "DEMO-BIL" },
  { key: "mdaPending", email: "admin@demo-pending.katdict.test", name: "Demo Pending Representative", type: "MDA_USER", roles: ["MDA_ADMIN"], mda: "DEMO-PND" },
] as const;

const demoMdas = [
  { abbreviation: "DEMO-MES", name: "DEMO Ministry of Example Services", category: "MINISTRY", status: "ACTIVE" },
  { abbreviation: "DEMO-ASR", name: "DEMO Agency for Sample Records", category: "AGENCY", status: "ACTIVE" },
  { abbreviation: "DEMO-BIL", name: "DEMO Board of Illustrative Learning", category: "BOARD", status: "ACTIVE" },
  { abbreviation: "DEMO-PND", name: "DEMO Commission for Pending Registration", category: "COMMISSION", status: "PENDING_REVIEW" },
] as const;

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

export async function seedDemo(log: (m: string) => void = console.log) {
  if (await prisma.mda.findUnique({ where: { abbreviation: "DEMO-MES" } })) {
    log("Demo data already present; skipping.");
    return;
  }
  // Demo convenience: MFA not enforced so demo accounts can sign in without an authenticator app.
  await prisma.systemSetting.upsert({ where: { key: "security.requireMfaForPrivileged" }, create: { key: "security.requireMfaForPrivileged", value: false, description: "DEMO: disabled for demonstration accounts" }, update: { value: false } });

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const mdaIds: Record<string, string> = {};
  for (const m of demoMdas) {
    const rec = await prisma.mda.create({
      data: {
        ...m, address: "Fictional address, Katsina (demo)", officialEmail: `info@${m.abbreviation.toLowerCase()}.katdict.test`, officialPhone: "+234 800 000 0000",
        contactPersonName: "Demo Contact", contactPersonDesignation: "Permanent Secretary (demo)", ictContactName: "Demo ICT Officer",
        description: "Fictional MDA for demonstration only.", submittedAt: new Date(), ...(m.status === "ACTIVE" ? { approvedAt: new Date(), activatedAt: new Date() } : {}),
      },
    });
    mdaIds[m.abbreviation] = rec.id;
  }
  const depts = Object.fromEntries((await prisma.department.findMany()).map((d) => [d.code, d.id]));
  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.key, r.id]));
  const ids: Record<string, string> = {};
  for (const u of demoUsers) {
    const user = await prisma.user.create({
      data: {
        email: u.email, name: u.name, passwordHash, userType: u.type, status: "ACTIVE", emailVerifiedAt: new Date(),
        departmentId: "dept" in u ? depts[u.dept] : null, skills: "skills" in u ? [...u.skills] : [],
        roles: { create: u.roles.map((r) => ({ roleId: roles[r] })) },
        ...("mda" in u ? { membership: { create: { mdaId: mdaIds[u.mda], isPrimaryRepresentative: (u.roles as readonly string[]).includes("MDA_ADMIN") } } } : {}),
      },
    });
    ids[u.key] = user.id;
  }
  await prisma.department.update({ where: { code: "SWD" }, data: { headId: ids.head } });
  await prisma.department.update({ where: { code: "INF" }, data: { headId: ids.headInf } });
  for (const m of demoMdas) {
    const rep = demoUsers.find((u) => "mda" in u && u.mda === m.abbreviation && (u.roles as readonly string[]).includes("MDA_ADMIN"));
    if (rep) await prisma.mda.update({ where: { id: mdaIds[m.abbreviation] }, data: { registeredById: ids[rep.key] } });
  }
  log(`demo users: ${demoUsers.length}, demo MDAs: ${demoMdas.length}`);

  const A = async (key: string): Promise<Actor> => (await loadActor(prisma, ids[key], { id: `seed-${key}`, mfaVerified: true }))!;
  const svc = async (code: string) => (await prisma.serviceDefinition.findUniqueOrThrow({ where: { code } })).id;
  const ver = async (id: string) => (await prisma.serviceRequest.findUniqueOrThrow({ where: { id } })).version;
  const pver = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).version;
  let keyN = 0;
  const key = () => `demo-submission-key-${String(++keyN).padStart(4, "0")}-${Date.now()}`;

  async function newRequest(mdaKey: string, serviceCode: string, title: string, problem: string, urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "MEDIUM") {
    const actor = await A(mdaKey);
    const d = await createDraft(actor, {
      serviceId: await svc(serviceCode), title, urgency,
      problemStatement: problem, currentSituation: "Processes are currently manual and paper-based (fictional demo scenario).",
      desiredOutcome: "A reliable digital process that reduces processing time and improves record accuracy.",
      businessJustification: "Improves accountability and service delivery to the public (demo).",
      expectedBeneficiaries: "MDA staff and members of the public (demo)", estimatedUsers: 250,
      expectedDeliverables: "Working system, user manual and staff training.",
      successCriteria: "80% of transactions processed digitally within 3 months of go-live.",
      institutionalImpact: "Faster processing and better reporting to the State Government (demo).",
      consequencesOfInaction: "Continued delays, lost files and limited oversight (demo).",
    });
    return submitRequest(actor, d.id, key());
  }

  async function toApproval(reqId: string, priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL", effort: number, cost: number) {
    const ops = await A("ops");
    await transitionRequest(ops, reqId, "start_triage", {}, await ver(reqId));
    await transitionRequest(ops, reqId, "accept_for_assessment", { triage: { priority, assignedDepartmentId: depts.SWD, assessorId: ids.ops } }, await ver(reqId));
    await recordAssessment(ops, reqId, { stage: "ASSESSMENT", findings: "Request is clear and within KATDICT mandate (demo assessment)." });
    await transitionRequest(ops, reqId, "send_to_technical_evaluation", {}, await ver(reqId));
    const head = await A("head");
    await recordAssessment(head, reqId, { stage: "TECHNICAL", findings: "Technically feasible using the State's standard web stack (demo)." });
    await transitionRequest(head, reqId, "complete_technical_evaluation", {}, await ver(reqId));
    await recordAssessment(ops, reqId, { stage: "SCOPE", findings: "Scope agreed with MDA (demo).", proposedScope: "Design, build, test and deploy the system; train MDA staff; provide handover documentation.", estimatedEffortDays: effort, estimatedCostNgn: cost });
    await transitionRequest(ops, reqId, "submit_for_approval", {}, await ver(reqId));
  }

  async function approve(reqId: string, executive: boolean) {
    await decideApproval(await A("ops2"), reqId, "APPROVED", "Technically sound (demo).", await ver(reqId));
    await decideApproval(await A("head"), reqId, "APPROVED", "Department has capacity (demo).", await ver(reqId));
    if (executive) await decideApproval(await A("director"), reqId, "APPROVED", "Approved (demo).", await ver(reqId));
  }

  async function deliver(reqId: string, plannedEnd: Date) {
    const ops = await A("ops");
    const project = await initiateProject(ops, reqId, await ver(reqId));
    await transitionProject(ops, project.id, "start_planning", undefined, await pver(project.id));
    await assignProject(ops, project.id, {
      projectManagerId: ids.officer1, officerIds: [ids.officer2], instructions: "Deliver per approved scope; report fortnightly (demo).",
      expectedOutcomes: "System live and accepted by the MDA (demo).", startDate: new Date(), plannedEndDate: plannedEnd, reportingFrequency: "FORTNIGHTLY",
      allowOverCapacity: true,
    }, await pver(project.id));
    const o1 = await A("officer1");
    const o2 = await A("officer2");
    for (const a of await prisma.projectAssignment.findMany({ where: { projectId: project.id } })) {
      await acknowledgeAssignment(a.assigneeId === ids.officer1 ? o1 : o2, a.id);
    }
    await transitionProject(o1, project.id, "start_work", undefined, await pver(project.id));
    return project;
  }

  // 1. Fully delivered and closed project with report.
  const r1 = await newRequest("mda1", "WEB_APP_DEV_GENERAL", "Staff leave management web application", "Leave applications are processed on paper and approvals take weeks; records are frequently misplaced and HR cannot report on leave balances.");
  await toApproval(r1.id, "MEDIUM", 40, 8_000_000);
  await approve(r1.id, false);
  const p1 = await deliver(r1.id, new Date(Date.now() + 30 * 86400000));
  const o1 = await A("officer1");
  await createMilestone(o1, p1.id, { title: "Requirements and design", weight: 2, dueDate: new Date(Date.now() + 7 * 86400000) });
  await createMilestone(o1, p1.id, { title: "Build and deploy", weight: 3, dueDate: new Date(Date.now() + 20 * 86400000) });
  for (const m of await prisma.projectMilestone.findMany({ where: { projectId: p1.id } })) {
    await createTask(o1, p1.id, { title: `${m.title}: main activity`, milestoneId: m.id, assigneeId: ids.officer1 });
  }
  for (const t of await prisma.projectTask.findMany({ where: { projectId: p1.id } })) await setTaskStatus(o1, t.id, "DONE");
  for (const m of await prisma.projectMilestone.findMany({ where: { projectId: p1.id } })) await setMilestoneStatus(o1, m.id, "COMPLETED");
  for (const d of await prisma.projectDeliverable.findMany({ where: { projectId: p1.id } })) {
    await uploadFile(o1, { name: `${d.title}.pdf`, bytes: PDF_BYTES }, { deliverableId: d.id, category: "DELIVERABLE", visibility: "MDA_VISIBLE" });
    await submitDeliverable(o1, d.id);
  }
  await submitCompletion(o1, p1.id, { summary: "The leave management application was built, tested with HR and deployed (demo).", deliverablesSummary: "All standard deliverables uploaded (demo).", handoverInformation: "Admin credentials handed to the MDA ICT officer in person (demo)." });
  await reviewCompletion(await A("ops2"), p1.id, "APPROVED", "Evidence verified (demo).");
  await mdaAcceptanceDecision(await A("mda1"), p1.id, { outcome: "ACCEPTED", reason: "Works as agreed (demo).", rating: 4, feedback: "Good collaboration (demo)." });
  await closeProject(await A("ops2"), p1.id, { actualOutcome: "HR now processes leave online; approvals take days instead of weeks (demo).", lessonsLearned: "Early involvement of HR champions shortened user acceptance testing (demo).", followUpRecommendations: "Integrate with payroll in a later phase (demo)." });
  log("demo: closed project with completion report");

  // 2. In-progress project with an overdue milestone, a risk and a blocker.
  const r2 = await newRequest("mda2", "SOFTWARE_DEV_GENERAL", "Inventory and stores management system", "Stores inventory is tracked in spreadsheets; stock-outs and discrepancies are discovered late and audit queries cannot be answered quickly.", "HIGH");
  await toApproval(r2.id, "HIGH", 60, 20_000_000);
  await approve(r2.id, true);
  const p2 = await deliver(r2.id, new Date(Date.now() + 45 * 86400000));
  await createMilestone(o1, p2.id, { title: "Requirements sign-off", weight: 1, dueDate: new Date(Date.now() - 3 * 86400000) });
  await createMilestone(o1, p2.id, { title: "Pilot in central store", weight: 3, dueDate: new Date(Date.now() + 25 * 86400000) });
  const [m2a] = await prisma.projectMilestone.findMany({ where: { projectId: p2.id }, orderBy: { sortOrder: "asc" } });
  await createTask(o1, p2.id, { title: "Stakeholder workshop", milestoneId: m2a.id, assigneeId: ids.officer2 });
  await createTask(o1, p2.id, { title: "Document stock categories", milestoneId: m2a.id, assigneeId: ids.officer1 });
  const t2 = await prisma.projectTask.findFirstOrThrow({ where: { projectId: p2.id, title: "Stakeholder workshop" } });
  await setTaskStatus(o1, t2.id, "DONE");
  await addRisk(o1, p2.id, { title: "Store staff availability for training", likelihood: 3, impact: 4, mitigation: "Schedule training per shift (demo)." });
  await raiseBlocker(o1, p2.id, "Awaiting stock category list from the MDA (demo).", false);
  await addProjectComment(o1, p2.id, "Please share the official stock category list so we can complete requirements (demo).", "MDA_VISIBLE");
  await addProjectComment(o1, p2.id, "Internal: consider reusing the leave app's authentication module (demo).", "INTERNAL");
  log("demo: in-progress project with warnings");

  // 3. Similar request from another MDA (shared-solution detection) awaiting executive approval.
  const r3 = await newRequest("mda3", "SOFTWARE_DEV_GENERAL", "Stores inventory management system for the Board", "Inventory of learning materials and stores is tracked manually in spreadsheets, causing stock-outs and audit discrepancies.", "HIGH");
  await toApproval(r3.id, "HIGH", 70, 25_000_000);
  await decideApproval(await A("ops2"), r3.id, "APPROVED", "Consider a shared statewide inventory solution (demo).", await ver(r3.id));
  await decideApproval(await A("head"), r3.id, "APPROVED", "Capacity available (demo).", await ver(r3.id));
  log("demo: request awaiting executive approval");

  // 4. Request needing information from the MDA.
  const r4 = await newRequest("mda1staff", "NETWORK_INFRA_GENERAL", "Office LAN upgrade for the annex building", "The annex building has unreliable network points and staff share a single switch, causing frequent outages during working hours.");
  const ops = await A("ops");
  await transitionRequest(ops, r4.id, "start_triage", {}, await ver(r4.id));
  await transitionRequest(ops, r4.id, "accept_for_assessment", { triage: { priority: "MEDIUM", assignedDepartmentId: depts.INF } }, await ver(r4.id));
  await transitionRequest(ops, r4.id, "request_information", { reason: "Please provide the number of network points required per floor and a floor plan (demo)." }, await ver(r4.id));

  // 5. Newly submitted (triage queue) and 6. rejected.
  await newRequest("mda2", "ICT_TRAINING_GENERAL", "Basic digital skills training for records officers", "Records officers have limited computer skills, slowing the planned digitisation of files.");
  const r6 = await newRequest("mda3", "OTHER_GENERAL", "Purchase of personal mobile phones for all staff", "Staff have requested personal phones for communication; there is no clear institutional ICT need described.");
  await transitionRequest(ops, r6.id, "start_triage", {}, await ver(r6.id));
  await transitionRequest(ops, r6.id, "reject", { reason: "Not within KATDICT's ICT service mandate; personal devices are not provided (demo)." }, await ver(r6.id));

  // 7. A draft (visible only to its creator).
  await createDraft(await A("mda1"), { serviceId: await svc("GOV_PORTAL_GENERAL"), title: "Ministry website refresh (draft)" });

  // Knowledge repository.
  const kd = await saveKnowledgeDoc(ops, null, {
    title: "Standard approach for MDA web applications", summary: "Reusable pattern: shared authentication, standard hosting and a handover checklist (demo).",
    body: "Use the State's standard hosting environment, a shared authentication module, automated backups and a standard handover checklist covering credentials, user manual and training records. (Fictional demonstration content.)",
    category: "IMPLEMENTATION_PATTERN", tags: "web, pattern, handover", visibility: "ALL_USERS",
  });
  await setKnowledgeStatus(await A("ops2"), kd.id, "PUBLISHED");
  log("demo: knowledge, drafts, rejected and pending items created");
}
