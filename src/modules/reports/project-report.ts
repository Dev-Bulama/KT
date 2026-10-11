import { prisma, type Db } from "@/lib/db";
import { audit } from "@/modules/audit/audit";
import { DEFAULT_CALENDAR, type BusinessCalendar, workingDaysBetween } from "@/modules/sla/calendar";
import { timeBreakdown } from "@/modules/sla/sla";
import { loadCalendar } from "@/modules/sla/service";

/**
 * Automatic project completion report. Every value is derived from database
 * records; values that were never recorded are null and rendered as
 * "Not recorded". Nothing is estimated or invented.
 */

export interface PersonRef {
  name: string;
  email?: string | null;
}

export interface ProjectReportData {
  schemaVersion: 1;
  generatedAt: string;
  identification: {
    projectReference: string;
    requestReference: string | null;
    title: string;
    mda: string;
    serviceCategory: string;
    service: string;
    projectManager: PersonRef | null;
    officers: PersonRef[];
    department: string | null;
  };
  timeline: Record<
    | "requestCreated" | "submitted" | "initialReview" | "approved" | "assigned" | "acknowledged" | "started"
    | "plannedCompletion" | "completionSubmitted" | "mdaAccepted" | "closed",
    string | null
  >;
  performance: {
    calendarDaysSubmissionToClosure: number | null;
    workingDaysSubmissionToClosure: number | null;
    executionDurationDays: number | null;
    plannedVsActual: "ON_TIME" | "LATE" | "EARLY" | null;
    delayDays: number | null;
    daysAwaitingMdaInformation: number | null;
    daysAwaitingApproval: number | null;
    daysBlocked: number | null;
    milestonesCompleted: number;
    milestonesTotal: number;
    changeRequests: number;
    risksRecorded: number;
    reviewCycles: number;
    remediationCycles: number;
  };
  outcomes: {
    originalProblem: string | null;
    approvedScope: string | null;
    deliverables: { title: string; status: string; required: boolean }[];
    actualOutcome: string | null;
    mdaAcceptanceDecision: string | null;
    mdaRating: number | null;
    lessonsLearned: string | null;
    followUpRecommendations: string | null;
    closureType: string | null;
    exceptionalJustification: string | null;
  };
  accountability: {
    approvedBy: PersonRef[];
    assignedBy: PersonRef | null;
    performedBy: PersonRef[];
    completionReviewedBy: PersonRef | null;
    acceptedBy: PersonRef | null;
    closedBy: PersonRef | null;
  };
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface ReportSource {
  project: {
    reference: string; title: string; approvedScope: string; plannedEndDate: Date | null; actualEndDate: Date | null;
    assignedAt: Date | null; acknowledgedAt: Date | null; startedAt: Date | null; completionSubmittedAt: Date | null;
    acceptedAt: Date | null; closedAt: Date | null; remediationCount: number;
  };
  request: { reference: string | null; createdAt: Date; submittedAt: Date | null; approvedAt: Date | null; problemStatement: string | null };
  mdaName: string;
  serviceName: string;
  categoryName: string;
  departmentName: string | null;
  projectManager: PersonRef | null;
  officers: PersonRef[];
  requestHistory: { toStatus: string; createdAt: Date }[];
  projectHistory: { toStatus: string; createdAt: Date }[];
  milestones: { status: string }[];
  deliverables: { title: string; status: string; required: boolean }[];
  changeRequests: number;
  risks: number;
  submissions: { cycle: number; createdAt: Date; status: string; reviewedBy: PersonRef | null }[];
  acceptance: { outcome: string; createdAt: Date; decidedBy: PersonRef }[];
  ratings: number[];
  approvals: { outcome: string; decidedBy: PersonRef }[];
  firstAssignedBy: PersonRef | null;
  closure: { closedAt: Date; closureType: string; justification: string | null; actualOutcome: string | null; lessonsLearned: string | null; followUpRecommendations: string | null; closedBy: PersonRef } | null;
}

/** Pure metric computation (unit-tested). */
export function computeProjectReport(src: ReportSource, cal: BusinessCalendar = DEFAULT_CALENDAR, now = new Date()): ProjectReportData {
  const p = src.project;
  const closedAt = src.closure?.closedAt ?? p.closedAt;
  const initialReview = src.requestHistory.find((h) => h.toStatus === "INITIAL_TRIAGE")?.createdAt ?? null;
  const firstSubmission = src.submissions.length ? [...src.submissions].sort((a, b) => a.cycle - b.cycle)[0].createdAt : p.completionSubmittedAt;
  const reqEnd = src.requestHistory.length ? src.requestHistory[src.requestHistory.length - 1].createdAt : now;
  const reqTimes = src.requestHistory.length ? timeBreakdown(src.requestHistory, src.requestHistory[0].createdAt, reqEnd, [], cal) : null;
  const projTimes = src.projectHistory.length ? timeBreakdown(src.projectHistory, src.projectHistory[0].createdAt, closedAt ?? now, [], cal) : null;

  let plannedVsActual: ProjectReportData["performance"]["plannedVsActual"] = null;
  let delayDays: number | null = null;
  const actualEnd = p.actualEndDate ?? closedAt ?? null;
  if (p.plannedEndDate && actualEnd) {
    const diff = (actualEnd.getTime() - p.plannedEndDate.getTime()) / 86_400_000;
    plannedVsActual = diff > 1 ? "LATE" : diff < -1 ? "EARLY" : "ON_TIME";
    delayDays = round1(Math.max(0, diff));
  }
  const accepted = [...src.acceptance].reverse().find((a) => a.outcome === "ACCEPTED") ?? null;
  const lastAcceptance = src.acceptance.length ? src.acceptance[src.acceptance.length - 1] : null;
  const approvedSub = [...src.submissions].sort((a, b) => b.cycle - a.cycle).find((s) => s.status === "APPROVED") ?? null;

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    identification: {
      projectReference: p.reference, requestReference: src.request.reference, title: p.title, mda: src.mdaName,
      serviceCategory: src.categoryName, service: src.serviceName, projectManager: src.projectManager, officers: src.officers, department: src.departmentName,
    },
    timeline: {
      requestCreated: iso(src.request.createdAt), submitted: iso(src.request.submittedAt), initialReview: iso(initialReview),
      approved: iso(src.request.approvedAt), assigned: iso(p.assignedAt), acknowledged: iso(p.acknowledgedAt), started: iso(p.startedAt),
      plannedCompletion: iso(p.plannedEndDate), completionSubmitted: iso(firstSubmission), mdaAccepted: iso(p.acceptedAt ?? accepted?.createdAt), closed: iso(closedAt),
    },
    performance: {
      calendarDaysSubmissionToClosure: src.request.submittedAt && closedAt ? round1((closedAt.getTime() - src.request.submittedAt.getTime()) / 86_400_000) : null,
      workingDaysSubmissionToClosure: src.request.submittedAt && closedAt ? round1(workingDaysBetween(src.request.submittedAt, closedAt, cal)) : null,
      executionDurationDays: p.startedAt && (p.acceptedAt ?? closedAt) ? round1((((p.acceptedAt ?? closedAt) as Date).getTime() - p.startedAt.getTime()) / 86_400_000) : null,
      plannedVsActual,
      delayDays,
      daysAwaitingMdaInformation: reqTimes ? round1(reqTimes.byStatus["NEEDS_INFORMATION"] ?? 0) : null,
      daysAwaitingApproval: reqTimes ? round1(reqTimes.byStatus["APPROVAL_REVIEW"] ?? 0) : null,
      daysBlocked: projTimes ? round1(projTimes.byStatus["BLOCKED"] ?? 0) : null,
      milestonesCompleted: src.milestones.filter((m) => m.status === "COMPLETED").length,
      milestonesTotal: src.milestones.filter((m) => m.status !== "CANCELLED").length,
      changeRequests: src.changeRequests,
      risksRecorded: src.risks,
      reviewCycles: src.submissions.length,
      remediationCycles: p.remediationCount,
    },
    outcomes: {
      originalProblem: src.request.problemStatement,
      approvedScope: p.approvedScope,
      deliverables: src.deliverables,
      actualOutcome: src.closure?.actualOutcome ?? null,
      mdaAcceptanceDecision: lastAcceptance?.outcome ?? null,
      mdaRating: src.ratings.length ? round1(src.ratings.reduce((a, b) => a + b, 0) / src.ratings.length) : null,
      lessonsLearned: src.closure?.lessonsLearned ?? null,
      followUpRecommendations: src.closure?.followUpRecommendations ?? null,
      closureType: src.closure?.closureType ?? null,
      exceptionalJustification: src.closure?.closureType === "EXCEPTIONAL" ? src.closure.justification : null,
    },
    accountability: {
      approvedBy: src.approvals.filter((a) => a.outcome === "APPROVED").map((a) => a.decidedBy),
      assignedBy: src.firstAssignedBy,
      performedBy: [...(src.projectManager ? [src.projectManager] : []), ...src.officers],
      completionReviewedBy: approvedSub?.reviewedBy ?? null,
      acceptedBy: accepted?.decidedBy ?? null,
      closedBy: src.closure?.closedBy ?? null,
    },
  };
}

const person = (u: { name: string; email?: string | null } | null | undefined): PersonRef | null => (u ? { name: u.name, email: u.email ?? null } : null);

export async function loadReportSource(db: Db, projectId: string): Promise<ReportSource> {
  const p = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      request: { include: { history: { orderBy: { createdAt: "asc" } }, approvalDecisions: { orderBy: { createdAt: "asc" }, include: { decidedBy: true } }, service: { include: { category: true } } } },
      mda: true, department: true, projectManager: true,
      assignments: { orderBy: { assignedAt: "asc" }, include: { assignee: true, assignedBy: true } },
      history: { orderBy: { createdAt: "asc" } },
      milestones: true, deliverables: true, completionSubmissions: { include: { reviewedBy: true } },
      acceptanceDecisions: { orderBy: { createdAt: "asc" }, include: { decidedBy: true } }, feedback: true,
      closure: { include: { closedBy: true } },
      _count: { select: { scopeChanges: true, risks: true } },
    },
  });
  // Only approval decisions of the final approval cycle count as "approved by".
  const finalCycle = Math.max(0, ...p.request.approvalDecisions.map((a) => a.cycle));
  const officers = p.assignments.filter((a) => a.role === "OFFICER" && a.status !== "REASSIGNED" && a.status !== "REMOVED").map((a) => person(a.assignee)!);
  return {
    project: p,
    request: p.request,
    mdaName: p.mda.name,
    serviceName: p.request.service.name,
    categoryName: p.request.service.category.name,
    departmentName: p.department?.name ?? null,
    projectManager: person(p.projectManager),
    officers,
    requestHistory: p.request.history,
    projectHistory: p.history,
    milestones: p.milestones,
    deliverables: p.deliverables.map((d) => ({ title: d.title, status: d.status, required: d.required })),
    changeRequests: p._count.scopeChanges,
    risks: p._count.risks,
    submissions: p.completionSubmissions.map((s) => ({ cycle: s.cycle, createdAt: s.createdAt, status: s.status, reviewedBy: person(s.reviewedBy) })),
    acceptance: p.acceptanceDecisions.map((a) => ({ outcome: a.outcome, createdAt: a.createdAt, decidedBy: person(a.decidedBy)! })),
    ratings: p.feedback.map((f) => f.rating),
    approvals: p.request.approvalDecisions.filter((a) => a.cycle === finalCycle).map((a) => ({ outcome: a.outcome, decidedBy: person(a.decidedBy)! })),
    firstAssignedBy: person(p.assignments[0]?.assignedBy),
    closure: p.closure ? { ...p.closure, closedBy: person(p.closure.closedBy)! } : null,
  };
}

/** Generates and stores a new report version (draft until a human finalises it). */
export async function generateProjectReport(db: Db, projectId: string, actorId: string | null) {
  const cal = await loadCalendar().catch(() => DEFAULT_CALENDAR);
  const src = await loadReportSource(db, projectId);
  const data = computeProjectReport(src, cal);
  const last = await db.reportRecord.findFirst({ where: { type: "PROJECT_CLOSURE", projectId }, orderBy: { version: "desc" } });
  const rec = await db.reportRecord.create({
    data: {
      type: "PROJECT_CLOSURE", projectId, version: (last?.version ?? 0) + 1, title: `Project completion report — ${src.project.reference}`,
      data: data as never, generatedById: actorId, status: "DRAFT",
    },
  });
  await audit(db === prisma ? null : db, { actorId, action: "report.generated", entityType: "ReportRecord", entityId: rec.id, after: { type: "PROJECT_CLOSURE", projectId, version: rec.version } });
  return rec;
}
