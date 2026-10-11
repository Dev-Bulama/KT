import { prisma } from "@/lib/db";
import type { Actor } from "@/modules/rbac/actor";
import { assertCan } from "@/modules/rbac/authorize";
import { complaintScope, projectScope, requestScope } from "@/modules/rbac/scope";
import { getSetting } from "@/modules/settings/service";
import { evaluateSla, timeBreakdown } from "@/modules/sla/sla";
import { loadCalendar } from "@/modules/sla/service";
import { OPEN_REVIEW_STATUSES, PAUSED_REQUEST_STATUSES } from "@/modules/requests/workflow";
import { projectRiskBoard } from "@/modules/intelligence/service";

/** Early Warning Centre: one query per signal, all scoped to the actor. */
export async function earlyWarnings(actor: Actor) {
  assertCan(actor, "earlywarning.view");
  const now = new Date();
  const warnDays = await getSetting("workflow.deadlineWarningDays");
  const clarDays = await getSetting("workflow.clarificationEscalationDays");
  const scopeWarn = await getSetting("workflow.scopeChangeWarningCount");
  const soon = new Date(now.getTime() + warnDays * 86400000);
  const ps = projectScope(actor);
  const rs = requestScope(actor);

  const [overdueMilestones, approaching, unacknowledged, awaitingClarification, scopeChurn, complaints, openRequests] = await Promise.all([
    prisma.projectMilestone.findMany({
      where: { status: { in: ["PENDING", "IN_PROGRESS"] }, dueDate: { lt: now }, project: { AND: [ps, { status: { notIn: ["CLOSED", "CANCELLED"] } }] } },
      select: { id: true, title: true, dueDate: true, project: { select: { id: true, reference: true, title: true } } }, orderBy: { dueDate: "asc" }, take: 100,
    }),
    prisma.project.findMany({
      where: { AND: [ps, { plannedEndDate: { gte: now, lte: soon }, status: { notIn: ["CLOSED", "CANCELLED", "ACCEPTED"] } }] },
      select: { id: true, reference: true, title: true, plannedEndDate: true, progressPercent: true }, orderBy: { plannedEndDate: "asc" }, take: 100,
    }),
    prisma.projectAssignment.findMany({
      where: { status: "PENDING_ACKNOWLEDGMENT", expectedAckBy: { lt: now }, project: ps },
      select: { id: true, role: true, expectedAckBy: true, escalatedAt: true, assignee: { select: { name: true } }, project: { select: { id: true, reference: true } } }, take: 100,
    }),
    prisma.serviceRequest.findMany({
      where: { AND: [rs, { status: "NEEDS_INFORMATION" }] },
      select: { id: true, reference: true, title: true, mda: { select: { abbreviation: true } }, history: { where: { toStatus: "NEEDS_INFORMATION" }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } }, take: 100,
    }),
    prisma.project.findMany({
      where: { AND: [ps, { status: { notIn: ["CLOSED", "CANCELLED"] } }] },
      select: { id: true, reference: true, title: true, _count: { select: { scopeChanges: true } } },
    }).then((rows) => rows.filter((r) => r._count.scopeChanges >= scopeWarn)),
    prisma.complaint.findMany({ where: { AND: [complaintScope(actor), { status: { in: ["OPEN", "UNDER_REVIEW", "ESCALATED"] } }] }, select: { id: true, reference: true, subject: true, status: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 100 }),
    prisma.serviceRequest.findMany({
      where: { AND: [rs, { status: { in: OPEN_REVIEW_STATUSES }, submittedAt: { not: null } }] },
      select: { id: true, reference: true, title: true, status: true, submittedAt: true, history: { select: { toStatus: true, createdAt: true }, orderBy: { createdAt: "asc" } }, service: { select: { slaAssessmentDays: true, category: { select: { slaAssessmentDays: true } } } } },
      take: 500,
    }),
  ]);
  const cal = await loadCalendar();
  const slaBreaches = openRequests
    .map((r) => {
      const t = timeBreakdown(r.history, r.submittedAt!, now, PAUSED_REQUEST_STATUSES, cal);
      const target = r.service.slaAssessmentDays ?? r.service.category.slaAssessmentDays;
      return { id: r.id, reference: r.reference, title: r.title, status: r.status, sla: evaluateSla(t.activeWorkingDays, target, false), pausedDays: Math.round(t.pausedWorkingDays * 10) / 10 };
    })
    .filter((r) => r.sla.state === "BREACHED" || r.sla.state === "AT_RISK")
    .sort((a, b) => (b.sla.percentUsed ?? 0) - (a.sla.percentUsed ?? 0));

  const highRisk = (await projectRiskBoard(actor, 30)).filter((p) => p.level === "HIGH" || p.level === "CRITICAL");
  return {
    overdueMilestones,
    approaching,
    unacknowledged,
    awaitingClarification: awaitingClarification.map((r) => ({ ...r, waitingDays: r.history[0] ? Math.floor((now.getTime() - r.history[0].createdAt.getTime()) / 86400000) : null, escalate: r.history[0] ? now.getTime() - r.history[0].createdAt.getTime() > clarDays * 86400000 : false })),
    slaBreaches,
    scopeChurn,
    highRisk,
    complaints,
  };
}
