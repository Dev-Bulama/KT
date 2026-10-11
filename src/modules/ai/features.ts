import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { audit } from "@/modules/audit/audit";
import type { Actor } from "@/modules/rbac/actor";
import { assertCan, assertCanAny, can } from "@/modules/rbac/authorize";
import { projectScope, requestScope } from "@/modules/rbac/scope";
import { findSimilarRequests } from "@/modules/intelligence/service";
import { tokens, jaccard } from "@/modules/intelligence/similarity";
import { departmentBacklog, overview, requestsByStatus, unresolvedRequestsByMda } from "@/modules/analytics/metrics";
import { earlyWarnings } from "@/modules/quality/early-warning";
import { searchKnowledge } from "@/modules/knowledge/service";
import { loadScopedProject, canWorkOnProject } from "@/modules/projects/access";
import { recalculateProgress } from "@/modules/projects/service";
import { REQUEST_TRANSITIONS } from "@/modules/requests/workflow";
import { runAI, SYSTEM_GUARDRAILS, untrusted, type AIResult } from "./service";

// ===========================================================================
// AI FEATURE 1: request classification
// ===========================================================================

export const classificationSchema = z.object({
  suggestedCategoryCode: z.string(),
  technicalDomain: z.string(),
  suggestedDepartmentCode: z.string().nullable(),
  urgencyIndicators: z.array(z.string()),
  potentialRisks: z.array(z.string()),
  missingInformation: z.array(z.string()),
  assessmentQuestions: z.array(z.string()),
  rationale: z.string(),
});
export type Classification = z.infer<typeof classificationSchema> & { categoryName?: string | null; departmentName?: string | null };

async function loadRequestForAI(actor: Actor, requestId: string) {
  const r = await prisma.serviceRequest.findFirst({
    where: { AND: [{ id: requestId }, requestScope(actor)] },
    include: { service: { include: { category: true, suggestedDepartment: true } }, mda: { select: { name: true, category: true } }, _count: { select: { attachments: true } } },
  });
  if (!r) throw new NotFoundError();
  return r;
}

function requestFacts(r: Awaited<ReturnType<typeof loadRequestForAI>>) {
  return {
    title: r.title, service: r.service.name, category: r.service.category.name, urgency: r.urgency, problemStatement: r.problemStatement,
    currentSituation: r.currentSituation, desiredOutcome: r.desiredOutcome, businessJustification: r.businessJustification,
    expectedBeneficiaries: r.expectedBeneficiaries, estimatedUsers: r.estimatedUsers, existingSystems: r.existingSystems,
    technicalInformation: r.technicalInformation, knownDependencies: r.knownDependencies, expectedDeliverables: r.expectedDeliverables,
    successCriteria: r.successCriteria, institutionalImpact: r.institutionalImpact, operationalUrgency: r.operationalUrgency,
    legalConsiderations: r.legalConsiderations, consequencesOfInaction: r.consequencesOfInaction, attachments: r._count.attachments,
  };
}

const MISSING_CHECKS: [keyof ReturnType<typeof requestFacts>, string][] = [
  ["currentSituation", "Description of the current situation"],
  ["expectedBeneficiaries", "Expected beneficiaries"],
  ["existingSystems", "Existing systems involved"],
  ["technicalInformation", "Relevant technical information"],
  ["knownDependencies", "Known dependencies"],
  ["successCriteria", "Measurable success criteria"],
  ["expectedDeliverables", "Expected deliverables"],
];

export async function classifyRequest(actor: Actor, requestId: string): Promise<AIResult<Classification>> {
  assertCanAny(actor, ["request.triage", "request.assess"]);
  const r = await loadRequestForAI(actor, requestId);
  const [categories, departments] = await Promise.all([
    prisma.serviceCategory.findMany({ where: { active: true }, select: { code: true, name: true, description: true } }),
    prisma.department.findMany({ where: { active: true }, select: { code: true, name: true, description: true } }),
  ]);
  const facts = requestFacts(r);

  const fallback = (): Classification => {
    const text = tokens(`${facts.title} ${facts.problemStatement ?? ""} ${facts.desiredOutcome ?? ""} ${facts.technicalInformation ?? ""}`);
    const best = categories.map((c) => ({ c, s: jaccard(text, tokens(`${c.name} ${c.description ?? ""}`)) })).sort((a, b) => b.s - a.s)[0];
    const cat = best && best.s > 0.05 ? best.c : categories.find((c) => c.name === r.service.category.name) ?? categories[0];
    const urgency: string[] = [];
    if (r.urgency === "HIGH" || r.urgency === "CRITICAL") urgency.push(`MDA marked urgency as ${r.urgency}`);
    if (facts.legalConsiderations) urgency.push("Legal or regulatory considerations recorded");
    if ((facts.estimatedUsers ?? 0) >= 1000) urgency.push(`Large user base (${facts.estimatedUsers})`);
    if (/outage|down|breach|attack|failure|urgent|deadline/i.test(`${facts.problemStatement} ${facts.operationalUrgency}`)) urgency.push("Problem description mentions outage/security/deadline terms");
    const risks: string[] = [];
    if (facts.knownDependencies) risks.push("External dependencies recorded — confirm availability and ownership");
    if (facts.existingSystems) risks.push("Integration with existing systems — assess compatibility and data migration");
    if (!facts.attachments) risks.push("No supporting documents attached");
    return {
      suggestedCategoryCode: cat?.code ?? "", categoryName: cat?.name ?? null, technicalDomain: cat?.name ?? r.service.category.name,
      suggestedDepartmentCode: r.service.suggestedDepartment?.code ?? null, departmentName: r.service.suggestedDepartment?.name ?? null,
      urgencyIndicators: urgency, potentialRisks: risks,
      missingInformation: MISSING_CHECKS.filter(([k]) => !facts[k]).map(([, l]) => l),
      assessmentQuestions: [
        "Who is the accountable business owner within the MDA?",
        "What is the expected go-live date and is there a hard deadline?",
        ...(facts.existingSystems ? ["What data must be migrated or integrated from existing systems?"] : []),
        ...(!facts.successCriteria ? ["How will the MDA measure success after delivery?"] : []),
      ],
      rationale: "Rule-based: keyword overlap with category descriptions, the service's suggested department, and completeness checks.",
    };
  };

  const result: AIResult<Classification> = await runAI<Classification>(actor, "classification", { entityType: "ServiceRequest", entityId: requestId }, async (p) => {
    const out = await p.generateJson({
      system: SYSTEM_GUARDRAILS,
      effort: "low",
      schema: classificationSchema,
      prompt: `Classify this ICT service request for KATDICT triage staff.\nValid category codes: ${JSON.stringify(categories)}\nValid department codes: ${JSON.stringify(departments)}\nReturn codes exactly as listed (department may be null).\n${untrusted("service_request", facts)}`,
    });
    return out;
  }, fallback);

  // Validate model output against the data model; never trust codes blindly.
  if (result.source === "ai") {
    const cat = categories.find((c) => c.code === result.data.suggestedCategoryCode);
    const dep = departments.find((d) => d.code === result.data.suggestedDepartmentCode);
    result.data = { ...result.data, suggestedCategoryCode: cat?.code ?? "", categoryName: cat?.name ?? null, suggestedDepartmentCode: dep?.code ?? null, departmentName: dep?.name ?? null };
  }
  await storeRecommendation(actor, "classification", "ServiceRequest", requestId, result);
  return result;
}

// ===========================================================================
// AI FEATURE 2: request quality assessment
// ===========================================================================

export const qualitySchema = z.object({
  overallScore: z.number().min(0).max(100),
  issues: z.array(z.object({ field: z.string(), problem: z.string(), suggestion: z.string() })),
  summary: z.string(),
});
export type Quality = z.infer<typeof qualitySchema> & { possibleDuplicates: { id: string; reference: string | null; title: string; score: number; mda: { abbreviation: string } }[] };

const VAGUE = /\b(etc|and so on|various|some|things|stuff|asap|as soon as possible|improve|better|modern)\b/i;

export async function assessRequestQuality(actor: Actor, requestId: string): Promise<AIResult<Quality>> {
  const r = await loadRequestForAI(actor, requestId);
  if (actor.userType === "MDA_USER" && r.mdaId !== actor.mdaId) throw new ForbiddenError();
  if (actor.userType !== "MDA_USER") assertCanAny(actor, ["request.triage", "request.assess"]);
  const facts = requestFacts(r);
  // Duplicate candidates come from deterministic similarity over authorised records only.
  const possibleDuplicates = actor.userType === "MDA_USER" ? [] : await findSimilarRequests(actor, requestId);

  const fallback = (): Omit<Quality, "possibleDuplicates"> => {
    const issues: Quality["issues"] = [];
    const check = (field: keyof typeof facts, label: string, min: number) => {
      const v = (facts[field] as string | null) ?? "";
      if (!v) issues.push({ field: label, problem: "Not provided", suggestion: `Add ${label.toLowerCase()}.` });
      else if (v.length < min) issues.push({ field: label, problem: "Very brief", suggestion: `Expand ${label.toLowerCase()} with specific, measurable detail.` });
      else if (VAGUE.test(v)) issues.push({ field: label, problem: "Contains vague wording", suggestion: "Replace general terms with concrete processes, numbers and dates." });
    };
    check("problemStatement", "Problem statement", 80);
    check("desiredOutcome", "Desired outcome", 40);
    check("expectedDeliverables", "Expected deliverables", 20);
    check("successCriteria", "Success criteria", 20);
    check("businessJustification", "Business justification", 40);
    if (r.service.requiredAttachments.length > facts.attachments) issues.push({ field: "Supporting documents", problem: `Service expects: ${r.service.requiredAttachments.join(", ")}`, suggestion: "Attach the required documents." });
    if (facts.successCriteria && !/\d/.test(facts.successCriteria)) issues.push({ field: "Success criteria", problem: "No measurable targets", suggestion: "Include numbers, e.g. '90% of staff using the system within 3 months'." });
    const score = Math.max(0, 100 - issues.length * 12);
    return { overallScore: score, issues, summary: issues.length ? `${issues.length} area(s) could be strengthened before assessment.` : "The request contains the core information needed for assessment." };
  };

  const res = await runAI(actor, "quality", { entityType: "ServiceRequest", entityId: requestId }, (p) =>
    p.generateJson({
      system: SYSTEM_GUARDRAILS, effort: "low", schema: qualitySchema,
      prompt: `Assess whether this service request contains sufficient information for KATDICT to assess it. Identify ambiguous problem statements, missing deliverables, missing or unmeasurable success criteria, unclear requirements and incomplete documentation (attachment count given). Give actionable suggestions. Score 0-100.\n${untrusted("service_request", facts)}`,
    }), fallback);
  return { ...res, data: { ...res.data, possibleDuplicates } };
}

// ===========================================================================
// AI FEATURE 3: project planning assistant (draft only)
// ===========================================================================

export const planSchema = z.object({
  phases: z.array(z.object({
    name: z.string(),
    milestones: z.array(z.object({
      title: z.string(),
      weight: z.number().int().min(1).max(10),
      durationDays: z.number().int().min(1).max(365),
      tasks: z.array(z.string()),
    })),
  })),
  dependencies: z.array(z.string()),
  risks: z.array(z.string()),
  requiredSkills: z.array(z.string()),
  testingRequirements: z.array(z.string()),
  documentationRequirements: z.array(z.string()),
});
export type ProjectPlan = z.infer<typeof planSchema>;

const TEMPLATES: Record<string, string[][]> = {
  software: [["Requirements and design", "Requirements workshop with MDA", "Process mapping", "Solution design approval"], ["Build", "Environment setup", "Core module development", "Integration"], ["Testing", "System testing", "User acceptance testing with MDA"], ["Deployment and handover", "Production deployment", "User training", "Handover documentation"]],
  infrastructure: [["Site survey and design", "Site survey", "Bill of materials", "Design approval"], ["Procurement and installation", "Equipment delivery verification", "Installation", "Configuration"], ["Testing and commissioning", "Connectivity/performance testing", "Commissioning sign-off"], ["Handover", "As-built documentation", "Operator training"]],
  assessment: [["Planning", "Scope and methodology agreed", "Information request issued"], ["Fieldwork", "Interviews and evidence collection", "Technical testing"], ["Reporting", "Draft findings", "Management responses", "Final report"]],
  training: [["Needs analysis", "Training needs assessment", "Curriculum design"], ["Delivery", "Materials preparation", "Training sessions"], ["Evaluation", "Participant assessment", "Training report"]],
};

function templateFor(category: string): string[][] {
  const c = category.toLowerCase();
  if (/hardware|network|connectivity|infrastructure|cloud|disaster/.test(c)) return TEMPLATES.infrastructure;
  if (/audit|assessment|security|evaluation|advisory|policy|consult/.test(c)) return TEMPLATES.assessment;
  if (/training|capacity/.test(c)) return TEMPLATES.training;
  return TEMPLATES.software;
}

export async function suggestProjectPlan(actor: Actor, projectId: string): Promise<AIResult<ProjectPlan>> {
  const p = await loadScopedProject(prisma, actor, projectId, { request: { include: { service: { include: { category: true } } } }, deliverables: true });
  if (!(await canWorkOnProject(prisma, actor, p)) && !can(actor, "project.assign")) throw new ForbiddenError();
  const fallback = (): ProjectPlan => {
    const t = templateFor(p.request.service.category.name);
    return {
      phases: t.map(([name, ...tasks], i) => ({ name, milestones: [{ title: name, weight: i === 1 ? 3 : 2, durationDays: Math.max(5, Math.round((p.estimatedEffortDays ?? 40) / t.length)), tasks }] })),
      dependencies: ["Each phase starts after sign-off of the previous phase", ...(p.dependenciesNote ? [p.dependenciesNote] : [])],
      risks: ["MDA stakeholder availability for reviews and acceptance", "Scope growth after design approval", "Procurement or vendor lead times"],
      requiredSkills: [p.request.service.category.name, "Project management", "Stakeholder engagement"],
      testingRequirements: ["Documented test cases mapped to success criteria", "MDA user acceptance sign-off"],
      documentationRequirements: [...p.deliverables.map((d) => d.title), "Handover and maintenance guide"],
    };
  };
  const res = await runAI(actor, "planning", { entityType: "Project", entityId: projectId }, (prov) =>
    prov.generateJson({
      system: SYSTEM_GUARDRAILS, schema: planSchema, effort: "medium",
      prompt: `Draft a work breakdown for this approved project. This is a DRAFT for the project manager to review; keep it realistic for a state government ICT directorate. Estimated effort (days): ${p.estimatedEffortDays ?? "not recorded"}.\n${untrusted("project", { title: p.title, category: p.request.service.category.name, service: p.request.service.name, approvedScope: p.approvedScope, deliverables: p.deliverables.map((d) => d.title), dependencies: p.dependenciesNote, resources: p.requiredResources })}`,
    }), fallback);
  await storeRecommendation(actor, "planning", "Project", projectId, res);
  return res;
}

/** Human approval step: adopts a stored plan recommendation as milestones/tasks. */
export async function adoptProjectPlan(actor: Actor, recommendationId: string) {
  const rec = await prisma.aIRecommendation.findUnique({ where: { id: recommendationId } });
  if (!rec || rec.feature !== "planning" || rec.entityType !== "Project") throw new NotFoundError();
  if (rec.status !== "PROPOSED") throw new AppError("This plan has already been reviewed.");
  const p = await loadScopedProject(prisma, actor, rec.entityId, {});
  if (!(await canWorkOnProject(prisma, actor, p))) throw new ForbiddenError();
  const plan = planSchema.parse((rec.payload as { data: unknown }).data);
  const start = p.startDate ?? new Date();
  await prisma.$transaction(async (tx) => {
    let cursor = start.getTime();
    let order = await tx.projectMilestone.count({ where: { projectId: p.id } });
    for (const phase of plan.phases) {
      for (const m of phase.milestones) {
        cursor += m.durationDays * 86400000;
        const ms = await tx.projectMilestone.create({ data: { projectId: p.id, title: m.title.slice(0, 200), weight: m.weight, dueDate: new Date(cursor), sortOrder: order++ } });
        for (const t of m.tasks.slice(0, 20)) await tx.projectTask.create({ data: { projectId: p.id, milestoneId: ms.id, title: t.slice(0, 200), createdById: actor.id, dueDate: new Date(cursor) } });
      }
    }
    await tx.aIRecommendation.update({ where: { id: rec.id }, data: { status: "ACCEPTED", reviewedById: actor.id, reviewedAt: new Date() } });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "ai.plan_adopted", entityType: "Project", entityId: p.id, after: { recommendationId: rec.id, source: rec.source, milestones: plan.phases.reduce((s, x) => s + x.milestones.length, 0) } });
    await recalculateProgress(tx, p.id, actor.id);
  });
}

export async function dismissRecommendation(actor: Actor, recommendationId: string) {
  const rec = await prisma.aIRecommendation.findUnique({ where: { id: recommendationId } });
  if (!rec) throw new NotFoundError();
  if (actor.userType !== "KATDICT_STAFF") throw new ForbiddenError();
  await prisma.aIRecommendation.update({ where: { id: rec.id }, data: { status: "DISMISSED", reviewedById: actor.id, reviewedAt: new Date() } });
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "ai.recommendation_dismissed", entityType: rec.entityType, entityId: rec.entityId, after: { recommendationId: rec.id } });
}

async function storeRecommendation(actor: Actor, feature: string, entityType: string, entityId: string, res: AIResult<unknown>) {
  return prisma.aIRecommendation.create({ data: { feature, entityType, entityId, payload: { data: res.data, notice: res.notice } as never, source: res.source, createdById: actor.id } });
}

// ===========================================================================
// AI FEATURE 4: assignment recommendations (transparent scoring; no AI needed)
// ===========================================================================

export interface AssignmentRecommendation {
  userId: string;
  name: string;
  department: string | null;
  score: number;
  criteria: { label: string; value: string; points: number }[];
  atCapacity: boolean;
}

/**
 * Ranks eligible officers using only recorded, job-related data:
 * skill match (40), spare capacity (30), department match (15),
 * on-time delivery history (15). No personal characteristics are used.
 * Output is a recommendation; a human makes the assignment.
 */
export async function recommendAssignees(actor: Actor, projectId: string): Promise<AssignmentRecommendation[]> {
  assertCanAny(actor, ["project.assign", "project.assign.department"]);
  const p = await loadScopedProject(prisma, actor, projectId, { request: { include: { service: { include: { category: true } } } } });
  const need = tokens(`${p.request.service.category.name} ${p.request.service.name} ${p.title}`);
  const officers = await prisma.user.findMany({
    where: { userType: "KATDICT_STAFF", status: "ACTIVE", roles: { some: { role: { permissions: { some: { permission: { key: "project.update" } } } } } } },
    select: {
      id: true, name: true, skills: true, maxConcurrentProjects: true, departmentId: true, department: { select: { name: true } },
      assignments: { where: { status: { in: ["PENDING_ACKNOWLEDGMENT", "ACKNOWLEDGED"] }, project: { status: { notIn: ["CLOSED", "CANCELLED"] } } }, select: { id: true } },
      managedProjects: { where: { status: "CLOSED" }, select: { plannedEndDate: true, actualEndDate: true } },
    },
  });
  return officers
    .map((o) => {
      const skillTokens = tokens(o.skills.join(" "));
      const overlap = [...need].filter((t) => skillTokens.has(t));
      const skillPts = Math.min(40, overlap.length * 15);
      const load = o.assignments.length;
      const spare = Math.max(0, o.maxConcurrentProjects - load);
      const capPts = o.maxConcurrentProjects ? Math.round((spare / o.maxConcurrentProjects) * 30) : 0;
      const deptPts = p.departmentId && o.departmentId === p.departmentId ? 15 : 0;
      const withPlan = o.managedProjects.filter((m) => m.plannedEndDate && m.actualEndDate);
      const onTime = withPlan.filter((m) => m.actualEndDate!.getTime() <= m.plannedEndDate!.getTime() + 86400000).length;
      const histPts = withPlan.length >= 2 ? Math.round((onTime / withPlan.length) * 15) : 7; // neutral when history is insufficient
      return {
        userId: o.id, name: o.name, department: o.department?.name ?? null, score: skillPts + capPts + deptPts + histPts, atCapacity: spare === 0,
        criteria: [
          { label: "Skill match", value: overlap.length ? overlap.join(", ") : "No recorded matching skills", points: skillPts },
          { label: "Current workload", value: `${load} of ${o.maxConcurrentProjects} active projects`, points: capPts },
          { label: "Department", value: deptPts ? "Same as responsible department" : (o.department?.name ?? "Not set"), points: deptPts },
          { label: "Delivery history", value: withPlan.length >= 2 ? `${onTime}/${withPlan.length} managed projects on time` : "Insufficient history (neutral score)", points: histPts },
        ],
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

// ===========================================================================
// AI FEATURE 6: executive intelligence briefing
// ===========================================================================

export const briefingSchema = z.object({
  headline: z.string(),
  sections: z.array(z.object({ title: z.string(), interpretation: z.string(), recommendedActions: z.array(z.string()) })),
});
export type Briefing = z.infer<typeof briefingSchema>;

export async function executiveBriefing(actor: Actor) {
  assertCan(actor, "ai.briefing");
  const since = new Date(Date.now() - 30 * 86400000);
  // FACTS: retrieved through the same permission-scoped analytics functions.
  const [ov, statuses, backlog, mdas, warnings, recent] = await Promise.all([
    overview(actor), requestsByStatus(actor), departmentBacklog(actor), unresolvedRequestsByMda(actor, 5), earlyWarnings(actor),
    prisma.project.findMany({ where: { AND: [projectScope(actor), { status: "CLOSED", closedAt: { gte: since } }] }, select: { reference: true, title: true }, take: 10 }),
  ]);
  const newRequests = await prisma.serviceRequest.count({ where: { AND: [requestScope(actor), { submittedAt: { gte: since } }] } });
  const pendingApprovals = statuses.find((s) => s.status === "APPROVAL_REVIEW")?.count ?? 0;
  const facts = {
    period: "last 30 days", newRequests, pendingApprovals, overview: ov, requestsByStatus: statuses,
    departmentBacklog: backlog.filter((d) => d.activeProjects || d.pendingRequests),
    mdasWithMostUnresolvedRequests: mdas,
    overdueMilestones: warnings.overdueMilestones.length, unacknowledgedAssignments: warnings.unacknowledged.length,
    slaBreaches: warnings.slaBreaches.filter((s) => s.sla.state === "BREACHED").length,
    highRiskProjects: warnings.highRisk.map((h) => ({ reference: h.reference, level: h.level, reasons: h.flags.map((f) => f.message) })).slice(0, 8),
    openComplaints: warnings.complaints.length,
    recentCompletions: recent,
  };
  const fallback = (): Briefing => ({
    headline: `${newRequests} new request(s) in the last 30 days; ${ov.activeProjects} active project(s), ${ov.overdueProjects} overdue.`,
    sections: [
      { title: "Demand", interpretation: `${newRequests} requests were submitted in the period and ${ov.awaitingReview} are awaiting review, of which ${pendingApprovals} are at the approval stage.`, recommendedActions: pendingApprovals ? ["Clear pending approval decisions."] : [] },
      { title: "Delivery", interpretation: `${ov.activeProjects} projects are active, ${ov.overdueProjects} are past their planned completion date and ${ov.highRiskProjects} carry high or critical risk.`, recommendedActions: ov.overdueProjects ? ["Review overdue projects with department heads."] : [] },
      { title: "Early warnings", interpretation: `${facts.overdueMilestones} overdue milestone(s), ${facts.unacknowledgedAssignments} unacknowledged assignment(s), ${facts.slaBreaches} request(s) beyond SLA, ${facts.openComplaints} open complaint(s).`, recommendedActions: facts.unacknowledgedAssignments ? ["Follow up unacknowledged assignments."] : [] },
      { title: "Completions", interpretation: recent.length ? `${recent.length} project(s) closed: ${recent.map((r) => r.reference).join(", ")}.` : "No projects were closed in the period.", recommendedActions: [] },
    ],
  });
  const res = await runAI(actor, "briefing", {}, (p) =>
    p.generateJson({
      system: SYSTEM_GUARDRAILS, schema: briefingSchema, effort: "medium",
      prompt: `Write an executive intelligence briefing for the KATDICT Director based ONLY on these database facts. Interpret patterns (backlogs, risks, bottlenecks, recurring issues) and recommend follow-up actions. Do not restate every number; do not invent figures.\n${untrusted("database_facts", facts)}`,
    }), fallback);
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "ai.briefing_generated", entityType: "Briefing", after: { source: res.source } });
  return { facts, ...res };
}

// ===========================================================================
// AI FEATURE 7: natural-language analytics (whitelisted, scoped functions)
// ===========================================================================

export const ANALYTICS_FUNCTIONS = {
  overdue_projects: "Projects past their planned completion date (optionally only those due this month)",
  mdas_unresolved_requests: "MDAs ranked by number of unresolved (open) service requests",
  requests_by_category: "Number of requests per service category, optionally filtered by review status",
  department_backlog: "Active, overdue projects and pending requests per KATDICT department",
  completed_delayed_projects: "Closed projects delivered after their planned completion date",
  risk_summary: "Projects with high/critical risk flags and the reasons, plus early warnings",
  requests_by_status: "Count of requests in each review status",
} as const;
type AnalyticsFn = keyof typeof ANALYTICS_FUNCTIONS;

export const analyticsPlanSchema = z.object({
  function: z.enum(Object.keys(ANALYTICS_FUNCTIONS) as [AnalyticsFn, ...AnalyticsFn[]]),
  params: z.object({
    thisMonthOnly: z.boolean().nullable(),
    categoryKeyword: z.string().nullable(),
    status: z.enum(["SUBMITTED", "INITIAL_TRIAGE", "UNDER_ASSESSMENT", "NEEDS_INFORMATION", "TECHNICAL_EVALUATION", "SCOPE_ESTIMATION", "APPROVAL_REVIEW", "APPROVED", "REJECTED", "DEFERRED"]).nullable(),
    limit: z.number().int().min(1).max(50).nullable(),
  }),
  restatedQuestion: z.string(),
});
type AnalyticsPlan = z.infer<typeof analyticsPlanSchema>;

export function routeQuestion(q: string): AnalyticsPlan {
  const s = q.toLowerCase();
  const p: AnalyticsPlan["params"] = { thisMonthOnly: /this month/.test(s) || null, categoryKeyword: null, status: null, limit: null };
  if (/under assessment|being assessed/.test(s)) p.status = "UNDER_ASSESSMENT";
  if (/awaiting approval|approval review/.test(s)) p.status = "APPROVAL_REVIEW";
  const cat = s.match(/(cyber ?security|network|software|mobile|training|hardware|cloud|database|gis|portal|analytics|ai|connectivity)/);
  if (cat) p.categoryKeyword = cat[1];
  let fn: AnalyticsFn = "requests_by_status";
  if (/overdue/.test(s) && /project/.test(s)) fn = "overdue_projects";
  else if (/(complet|closed|deliver)/.test(s) && /(delay|late)/.test(s)) fn = "completed_delayed_projects";
  else if (/mda/.test(s) && /(unresolved|open|pending|most|highest)/.test(s)) fn = "mdas_unresolved_requests";
  else if (/backlog|department/.test(s)) fn = "department_backlog";
  else if (/risk/.test(s)) fn = "risk_summary";
  else if (/(how many|number of|count)/.test(s) && (p.categoryKeyword || /categor/.test(s))) fn = "requests_by_category";
  return { function: fn, params: p, restatedQuestion: q };
}

async function executeAnalytics(actor: Actor, plan: AnalyticsPlan) {
  const now = new Date();
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const limit = plan.params.limit ?? 20;
  switch (plan.function) {
    case "overdue_projects": {
      const rows = await prisma.project.findMany({
        where: { AND: [projectScope(actor), { status: { notIn: ["CLOSED", "CANCELLED", "ACCEPTED"] } }, plan.params.thisMonthOnly ? { plannedEndDate: { lt: now < monthEnd ? now : monthEnd, gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) } } : { plannedEndDate: { lt: now } }] },
        select: { id: true, reference: true, title: true, plannedEndDate: true, status: true, mda: { select: { abbreviation: true } } }, orderBy: { plannedEndDate: "asc" }, take: limit,
      });
      return { columns: ["Reference", "Title", "MDA", "Planned completion", "Status"], rows: rows.map((r) => [r.reference, r.title, r.mda.abbreviation, r.plannedEndDate?.toISOString().slice(0, 10) ?? "", r.status]), links: rows.map((r) => `/projects/${r.id}`) };
    }
    case "mdas_unresolved_requests": {
      const rows = await unresolvedRequestsByMda(actor, limit);
      return { columns: ["MDA", "Unresolved requests"], rows: rows.map((r) => [r.mda, r.count]), links: rows.map((r) => `/mdas/${r.mdaId}`) };
    }
    case "requests_by_category": {
      const rows = await prisma.serviceRequest.groupBy({
        by: ["serviceId"], where: { AND: [requestScope(actor), { status: plan.params.status ? plan.params.status : { not: "DRAFT" } }, plan.params.categoryKeyword ? { service: { category: { name: { contains: plan.params.categoryKeyword, mode: "insensitive" } } } } : {}] }, _count: { _all: true },
      });
      const svcs = await prisma.serviceDefinition.findMany({ where: { id: { in: rows.map((r) => r.serviceId) } }, select: { id: true, name: true, category: { select: { name: true } } } });
      return { columns: ["Category", "Service", "Requests"], rows: rows.map((r) => { const s = svcs.find((x) => x.id === r.serviceId); return [s?.category.name ?? "", s?.name ?? "", r._count._all]; }), links: [] };
    }
    case "department_backlog": {
      const rows = await departmentBacklog(actor);
      return { columns: ["Department", "Active projects", "Overdue projects", "Pending requests"], rows: rows.map((r) => [r.department, r.activeProjects, r.overdueProjects, r.pendingRequests]).sort((a, b) => Number(b[1]) - Number(a[1])), links: [] };
    }
    case "completed_delayed_projects": {
      const rows = await prisma.project.findMany({ where: { AND: [projectScope(actor), { status: "CLOSED", plannedEndDate: { not: null } }] }, select: { id: true, reference: true, title: true, plannedEndDate: true, actualEndDate: true, closedAt: true }, take: 500 });
      const late = rows.filter((r) => (r.actualEndDate ?? r.closedAt)! > new Date(r.plannedEndDate!.getTime() + 86400000)).slice(0, limit);
      return { columns: ["Reference", "Title", "Planned", "Actual", "Days late"], rows: late.map((r) => { const a = (r.actualEndDate ?? r.closedAt)!; return [r.reference, r.title, r.plannedEndDate!.toISOString().slice(0, 10), a.toISOString().slice(0, 10), Math.round((a.getTime() - r.plannedEndDate!.getTime()) / 86400000)]; }), links: late.map((r) => `/projects/${r.id}`) };
    }
    case "risk_summary": {
      if (!can(actor, "earlywarning.view")) throw new ForbiddenError();
      const w = await earlyWarnings(actor);
      return { columns: ["Reference", "Risk level", "Reasons"], rows: w.highRisk.map((h) => [h.reference, h.level, h.flags.map((f) => f.message).join(" ")]), links: w.highRisk.map((h) => `/projects/${h.id}`) };
    }
    case "requests_by_status":
    default: {
      const rows = await requestsByStatus(actor);
      return { columns: ["Status", "Requests"], rows: rows.map((r) => [r.status, r.count]), links: [] };
    }
  }
}

export async function askAnalytics(actor: Actor, question: string) {
  assertCan(actor, "ai.analytics");
  const q = question.trim().slice(0, 500);
  if (q.length < 5) throw new AppError("Please ask a longer question.");
  const plan = await runAI(actor, "analytics", {}, (p) =>
    p.generateJson({
      system: `${SYSTEM_GUARDRAILS}\nYou translate questions into exactly one call from a fixed catalogue of analytics functions. You never write SQL.`,
      schema: analyticsPlanSchema, effort: "low",
      prompt: `Function catalogue: ${JSON.stringify(ANALYTICS_FUNCTIONS)}\nChoose the single best function and parameters (use null when not applicable).\n${untrusted("user_question", q)}`,
    }), () => routeQuestion(q));
  // The plan is validated by zod (schema) and executed through scoped functions only.
  const result = await executeAnalytics(actor, plan.data);
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "ai.analytics_query", entityType: "Analytics", after: { function: plan.data.function, source: plan.source } });
  return { plan: plan.data, source: plan.source, notice: plan.notice, result, description: ANALYTICS_FUNCTIONS[plan.data.function] };
}

// ===========================================================================
// AI FEATURE 8: report drafting (human review required)
// ===========================================================================

export async function draftReportSummary(actor: Actor, reportId: string) {
  assertCan(actor, "report.generate");
  const rep = await prisma.reportRecord.findUnique({ where: { id: reportId } });
  if (!rep) throw new NotFoundError();
  if (rep.projectId) await loadScopedProject(prisma, actor, rep.projectId, {});
  else if (!can(actor, "report.read.all")) throw new ForbiddenError();
  if (rep.status === "FINAL") throw new AppError("Final reports cannot be redrafted; generate a new version.");
  const d = rep.data as Record<string, unknown>;
  const fallback = () => {
    const perf = (d.performance ?? {}) as Record<string, unknown>;
    const id = (d.identification ?? {}) as Record<string, unknown>;
    const out = (d.outcomes ?? {}) as Record<string, unknown>;
    return `Project ${id.projectReference ?? ""} ("${id.title ?? ""}") for ${id.mda ?? "the MDA"} was closed ${perf.plannedVsActual === "LATE" ? `${perf.delayDays} day(s) after the planned date` : perf.plannedVsActual === "ON_TIME" ? "on schedule" : perf.plannedVsActual === "EARLY" ? "ahead of schedule" : "(planned date not recorded)"}. ${perf.milestonesCompleted ?? 0} of ${perf.milestonesTotal ?? 0} milestones were completed, with ${perf.changeRequests ?? 0} change request(s) and ${perf.reviewCycles ?? 0} review cycle(s). MDA decision: ${out.mdaAcceptanceDecision ?? "not recorded"}.`;
  };
  const res = await runAI(actor, "reportDrafting", { entityType: "ReportRecord", entityId: reportId }, async (p) => {
    const out = await p.generateText({ system: SYSTEM_GUARDRAILS, effort: "low", maxTokens: 4000, prompt: `Draft a concise executive summary (max 200 words) and a short lessons-learned paragraph for this project completion report. Use only the facts given; write "not recorded" for missing values.\n${untrusted("report_data", d)}` });
    return { data: out.text, usage: out.usage };
  }, fallback);
  await prisma.reportRecord.update({ where: { id: reportId }, data: { aiSummaryDraft: `[${res.source === "ai" ? "AI-generated draft" : "Rule-based draft"} — requires human review]\n\n${res.data}` } });
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "report.summary_drafted", entityType: "ReportRecord", entityId: reportId, after: { source: res.source } });
  return res;
}

// ===========================================================================
// AI FEATURE 12: contextual assistant
// ===========================================================================

export const assistantSchema = z.object({
  answer: z.string(),
  citations: z.array(z.string()),
  uncertain: z.boolean(),
});

const PROCEDURES = [
  { id: "PROC-ONBOARD", text: "MDA onboarding: register, verify email, KATDICT reviews the profile (approve, reject or request corrections), the MDA administrator activates the account, then invites staff." },
  { id: "PROC-REQUEST", text: "Service requests: create a draft with the 5-step wizard (service, information, impact, documents, review) and submit. A reference KATDICT-REQ-YYYY-NNNNN is issued. KATDICT triages, assesses, may request information, performs technical evaluation and scoping, then routes approval according to the configured approval policy." },
  { id: "PROC-PROJECT", text: "Projects: an approved request becomes a project. KATDICT assigns a department, project manager and officers who must acknowledge. Progress is calculated from milestones and tasks. Completion is submitted by the team, reviewed by KATDICT, then accepted or disputed by the MDA. Only after acceptance can an authorised officer close the project, which generates the completion report." },
  { id: "PROC-SCOPE", text: "Scope changes are requested on the project, assessed for schedule and resource impact, and approved or rejected by an authorised officer. Approved scope is never silently overwritten; history is preserved." },
  ...Object.entries(REQUEST_TRANSITIONS).map(([k, v]) => ({ id: `ACTION-${k}`, text: `Action "${v.label}" is possible from statuses ${v.from.join(", ")} and leads to ${v.to === "approval" ? "the next approval step or a decision" : v.to}. Performed by ${v.side === "MDA" ? "the MDA" : "KATDICT"}.${v.reasonRequired ? " A reason is required." : ""}` })),
];

export async function askAssistant(actor: Actor, question: string, context?: { requestId?: string; projectId?: string }) {
  assertCan(actor, "ai.use");
  const q = question.trim().slice(0, 1000);
  if (q.length < 3) throw new AppError("Please type a question.");
  // Retrieval: only records the actor can access (scoped queries) and authorised knowledge documents.
  const sources: { id: string; text: string }[] = [];
  const qt = tokens(q);
  for (const p of PROCEDURES) if (jaccard(qt, tokens(p.text)) > 0.04 || /how|what|why|procedure|process|status/.test(q.toLowerCase())) sources.push(p);
  if (context?.requestId) {
    const r = await prisma.serviceRequest.findFirst({ where: { AND: [{ id: context.requestId }, requestScope(actor)] }, select: { reference: true, title: true, status: true, submittedAt: true, priority: true } });
    if (r) sources.push({ id: r.reference ?? "DRAFT", text: `Request ${r.reference ?? "(draft)"} "${r.title}": status ${r.status}, priority ${r.priority ?? "not set"}, submitted ${r.submittedAt?.toISOString().slice(0, 10) ?? "not yet"}.` });
  }
  if (context?.projectId) {
    const p = await prisma.project.findFirst({ where: { AND: [{ id: context.projectId }, projectScope(actor)] }, select: { reference: true, title: true, status: true, acceptanceStatus: true, progressPercent: true, plannedEndDate: true } });
    if (p) sources.push({ id: p.reference, text: `Project ${p.reference} "${p.title}": status ${p.status}, acceptance ${p.acceptanceStatus}, progress ${p.progressPercent}%, planned completion ${p.plannedEndDate?.toISOString().slice(0, 10) ?? "not recorded"}.` });
  }
  const mine = await prisma.serviceRequest.findMany({ where: { AND: [requestScope(actor), { status: { not: "DRAFT" } }] }, orderBy: { updatedAt: "desc" }, take: 8, select: { reference: true, title: true, status: true } });
  for (const r of mine) if (jaccard(qt, tokens(`${r.title} ${r.reference}`)) > 0.1 || q.includes(r.reference ?? "@@")) sources.push({ id: r.reference!, text: `Request ${r.reference} "${r.title}" is ${r.status}.` });
  const kb = can(actor, "knowledge.read") ? await searchKnowledge(actor, q, undefined, 4) : [];
  for (const k of kb) sources.push({ id: `KB-${k.id.slice(-6)}`, text: `${k.title}: ${k.summary}` });
  const limited = sources.slice(0, 20);

  const fallback = () => ({
    answer: limited.length
      ? `Here is the most relevant information I found:\n\n${limited.slice(0, 5).map((s) => `• ${s.text} [${s.id}]`).join("\n")}`
      : "I could not find information on that in the records you can access. Try rephrasing, or contact KATDICT support.",
    citations: limited.slice(0, 5).map((s) => s.id),
    uncertain: limited.length === 0,
  });
  const res = await runAI(actor, "assistant", {}, (p) =>
    p.generateJson({
      system: `${SYSTEM_GUARDRAILS}\nAnswer the user's question using only the sources. Cite source ids in square brackets. If the sources do not answer the question, say so and set uncertain=true. You cannot perform actions; explain which page or button the user should use.`,
      schema: assistantSchema, effort: "low",
      prompt: `User role(s): ${actor.roles.join(", ")}\n${untrusted("sources", limited)}\n${untrusted("question", q)}`,
    }), fallback);
  // Citations must reference provided sources only.
  res.data.citations = res.data.citations.filter((c) => limited.some((s) => s.id === c));
  return res;
}
