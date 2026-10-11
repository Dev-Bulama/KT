import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { Actor } from "@/modules/rbac/actor";
import { can } from "@/modules/rbac/authorize";
import { mdaScope, projectScope, requestScope } from "@/modules/rbac/scope";
import { OPEN_REVIEW_STATUSES } from "@/modules/requests/workflow";
import { ACTIVE_PROJECT_STATUSES } from "@/modules/projects/workflow";
import { workingDaysBetween } from "@/modules/sla/calendar";
import { loadCalendar } from "@/modules/sla/service";

/**
 * Analytics. Every function:
 *  - applies the actor's row-level scope (requestScope/projectScope/mdaScope),
 *  - aggregates on the server (COUNT/GROUP BY in PostgreSQL where possible),
 *  - returns only aggregate figures and record references the actor may see.
 */

export interface DateRange {
  from?: Date;
  to?: Date;
}

const rangeWhere = (field: string, r: DateRange) =>
  r.from || r.to ? { [field]: { ...(r.from ? { gte: r.from } : {}), ...(r.to ? { lte: r.to } : {}) } } : {};

const OPEN_PROJECT: Prisma.ProjectWhereInput = { status: { in: ACTIVE_PROJECT_STATUSES.filter((s) => s !== "ACCEPTED") } };

export function overdueProjectWhere(now = new Date()): Prisma.ProjectWhereInput {
  return { plannedEndDate: { lt: now }, status: { notIn: ["CLOSED", "CANCELLED", "ACCEPTED"] } };
}

export async function overview(actor: Actor, r: DateRange = {}) {
  const rs = requestScope(actor);
  const ps = projectScope(actor);
  const ms = mdaScope(actor);
  const submitted = { status: { not: "DRAFT" as const } };
  const [totalMdas, activeMdas, totalRequests, awaitingReview, approved, activeProjects, completedProjects, overdueProjects, highRiskProjects, avgRating] = await Promise.all([
    prisma.mda.count({ where: { AND: [ms, { status: { not: "DIRECTORY" } }] } }),
    prisma.mda.count({ where: { AND: [ms, { status: "ACTIVE" }] } }),
    prisma.serviceRequest.count({ where: { AND: [rs, submitted, rangeWhere("submittedAt", r)] } }),
    prisma.serviceRequest.count({ where: { AND: [rs, { status: { in: OPEN_REVIEW_STATUSES } }] } }),
    prisma.serviceRequest.count({ where: { AND: [rs, { status: { in: ["APPROVED", "PROJECT_INITIATED"] } }, rangeWhere("approvedAt", r)] } }),
    prisma.project.count({ where: { AND: [ps, OPEN_PROJECT] } }),
    prisma.project.count({ where: { AND: [ps, { status: "CLOSED" }, rangeWhere("closedAt", r)] } }),
    prisma.project.count({ where: { AND: [ps, overdueProjectWhere()] } }),
    prisma.project.count({ where: { AND: [ps, OPEN_PROJECT, { riskLevel: { in: ["HIGH", "CRITICAL"] } }] } }),
    prisma.feedback.aggregate({ where: can(actor, "feedback.read.all") ? rangeWhere("createdAt", r) : { mdaId: actor.mdaId ?? "__none__" }, _avg: { rating: true }, _count: true }),
  ]);
  return {
    totalMdas, activeMdas, totalRequests, awaitingReview, approved, activeProjects, completedProjects, overdueProjects, highRiskProjects,
    satisfaction: avgRating._avg.rating ? Math.round(avgRating._avg.rating * 10) / 10 : null,
    satisfactionResponses: avgRating._count,
  };
}

export async function requestsByStatus(actor: Actor, r: DateRange = {}) {
  const rows = await prisma.serviceRequest.groupBy({
    by: ["status"], where: { AND: [requestScope(actor), { status: { not: "DRAFT" } }, rangeWhere("submittedAt", r)] }, _count: { _all: true },
  });
  return rows.map((x) => ({ status: x.status, count: x._count._all })).sort((a, b) => b.count - a.count);
}

export async function requestsByCategory(actor: Actor, r: DateRange = {}, statusIn?: string[]) {
  const rows = await prisma.serviceRequest.groupBy({
    by: ["serviceId"],
    where: { AND: [requestScope(actor), { status: { not: "DRAFT" } }, rangeWhere("submittedAt", r), statusIn ? { status: { in: statusIn as never } } : {}] },
    _count: { _all: true },
  });
  const services = await prisma.serviceDefinition.findMany({ where: { id: { in: rows.map((x) => x.serviceId) } }, select: { id: true, category: { select: { id: true, name: true } } } });
  const byCat = new Map<string, { categoryId: string; category: string; count: number }>();
  for (const row of rows) {
    const cat = services.find((s) => s.id === row.serviceId)?.category;
    if (!cat) continue;
    const cur = byCat.get(cat.id) ?? { categoryId: cat.id, category: cat.name, count: 0 };
    cur.count += row._count._all;
    byCat.set(cat.id, cur);
  }
  return [...byCat.values()].sort((a, b) => b.count - a.count);
}

export async function unresolvedRequestsByMda(actor: Actor, limit = 10) {
  const rows = await prisma.serviceRequest.groupBy({
    by: ["mdaId"], where: { AND: [requestScope(actor), { status: { in: OPEN_REVIEW_STATUSES } }] }, _count: { _all: true },
    orderBy: { _count: { mdaId: "desc" } }, take: limit,
  });
  const mdas = await prisma.mda.findMany({ where: { id: { in: rows.map((r) => r.mdaId) } }, select: { id: true, name: true, abbreviation: true } });
  return rows.map((r) => ({ mdaId: r.mdaId, mda: mdas.find((m) => m.id === r.mdaId)?.name ?? "Unknown", abbreviation: mdas.find((m) => m.id === r.mdaId)?.abbreviation ?? "", count: r._count._all }));
}

export async function departmentBacklog(actor: Actor) {
  const rows = await prisma.project.groupBy({ by: ["departmentId"], where: { AND: [projectScope(actor), OPEN_PROJECT] }, _count: { _all: true } });
  const overdue = await prisma.project.groupBy({ by: ["departmentId"], where: { AND: [projectScope(actor), overdueProjectWhere()] }, _count: { _all: true } });
  const pendingReq = await prisma.serviceRequest.groupBy({ by: ["assignedDepartmentId"], where: { AND: [requestScope(actor), { status: { in: OPEN_REVIEW_STATUSES } }] }, _count: { _all: true } });
  const depts = await prisma.department.findMany({ select: { id: true, name: true } });
  return depts
    .map((d) => ({
      departmentId: d.id, department: d.name,
      activeProjects: rows.find((r) => r.departmentId === d.id)?._count._all ?? 0,
      overdueProjects: overdue.find((r) => r.departmentId === d.id)?._count._all ?? 0,
      pendingRequests: pendingReq.find((r) => r.assignedDepartmentId === d.id)?._count._all ?? 0,
    }))
    .concat([{
      departmentId: "", department: "Unassigned",
      activeProjects: rows.find((r) => r.departmentId === null)?._count._all ?? 0,
      overdueProjects: overdue.find((r) => r.departmentId === null)?._count._all ?? 0,
      pendingRequests: pendingReq.find((r) => r.assignedDepartmentId === null)?._count._all ?? 0,
    }])
    .filter((d) => d.activeProjects + d.pendingRequests + d.overdueProjects > 0 || d.departmentId);
}

export async function officerWorkload(actor: Actor, departmentId?: string) {
  const officers = await prisma.user.findMany({
    where: { userType: "KATDICT_STAFF", status: "ACTIVE", roles: { some: { role: { key: "PROJECT_OFFICER" } } }, ...(departmentId ? { departmentId } : {}) },
    select: {
      id: true, name: true, maxConcurrentProjects: true, skills: true, department: { select: { name: true } },
      assignments: { where: { status: { in: ["PENDING_ACKNOWLEDGMENT", "ACKNOWLEDGED"] }, project: { AND: [projectScope(actor), OPEN_PROJECT] } }, select: { status: true, project: { select: { plannedEndDate: true } } } },
      tasks: { where: { status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] } }, select: { dueDate: true } },
    },
    orderBy: { name: "asc" },
  });
  const now = Date.now();
  return officers.map((o) => ({
    id: o.id, name: o.name, department: o.department?.name ?? "—", capacity: o.maxConcurrentProjects, skills: o.skills,
    activeAssignments: o.assignments.length,
    pendingAcknowledgements: o.assignments.filter((a) => a.status === "PENDING_ACKNOWLEDGMENT").length,
    openTasks: o.tasks.length,
    overdueTasks: o.tasks.filter((t) => t.dueDate && t.dueDate.getTime() < now).length,
    utilisation: o.maxConcurrentProjects ? Math.round((o.assignments.length / o.maxConcurrentProjects) * 100) : null,
  }));
}

/** Monthly counts for the last N months: requests submitted and projects closed. */
export async function monthlyTrends(actor: Actor, months = 12) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCMonth(start.getUTCMonth() - (months - 1));
  const [reqs, closed] = await Promise.all([
    prisma.serviceRequest.findMany({ where: { AND: [requestScope(actor), { submittedAt: { gte: start } }] }, select: { submittedAt: true } }),
    prisma.project.findMany({ where: { AND: [projectScope(actor), { closedAt: { gte: start } }] }, select: { closedAt: true } }),
  ]);
  const buckets: { month: string; submitted: number; completed: number }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(start);
    d.setUTCMonth(start.getUTCMonth() + i);
    buckets.push({ month: d.toISOString().slice(0, 7), submitted: 0, completed: 0 });
  }
  for (const r of reqs) {
    const b = buckets.find((x) => x.month === r.submittedAt!.toISOString().slice(0, 7));
    if (b) b.submitted++;
  }
  for (const p of closed) {
    const b = buckets.find((x) => x.month === p.closedAt!.toISOString().slice(0, 7));
    if (b) b.completed++;
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Scorecard
// ---------------------------------------------------------------------------

export interface ScorecardMetric {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  sampleSize: number;
  definition: string;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

export async function scorecard(actor: Actor, r: DateRange = {}, filter: { departmentId?: string } = {}): Promise<ScorecardMetric[]> {
  const cal = await loadCalendar();
  const deptP: Prisma.ProjectWhereInput = filter.departmentId ? { departmentId: filter.departmentId } : {};
  const deptR: Prisma.ServiceRequestWhereInput = filter.departmentId ? { assignedDepartmentId: filter.departmentId } : {};
  const [decided, approvals, closed, acceptance, overdue, ratings, openBacklog] = await Promise.all([
    prisma.serviceRequest.findMany({ where: { AND: [requestScope(actor), deptR, { decidedAt: { not: null }, submittedAt: { not: null } }, rangeWhere("decidedAt", r)] }, select: { submittedAt: true, decidedAt: true } }),
    prisma.serviceRequest.findMany({
      where: { AND: [requestScope(actor), deptR, { decidedAt: { not: null } }, rangeWhere("decidedAt", r)] },
      select: { decidedAt: true, history: { where: { toStatus: "APPROVAL_REVIEW" }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } },
    }),
    prisma.project.findMany({ where: { AND: [projectScope(actor), deptP, { status: "CLOSED" }, rangeWhere("closedAt", r)] }, select: { startedAt: true, acceptedAt: true, closedAt: true, plannedEndDate: true, actualEndDate: true, remediationCount: true } }),
    prisma.acceptanceDecision.findMany({ where: { AND: [{ project: { AND: [projectScope(actor), deptP] } }, rangeWhere("createdAt", r), { outcome: { in: ["ACCEPTED", "REJECTED", "INCOMPLETE_DELIVERABLES"] } }] }, select: { outcome: true } }),
    prisma.project.count({ where: { AND: [projectScope(actor), deptP, overdueProjectWhere()] } }),
    prisma.feedback.findMany({ where: { AND: [can(actor, "feedback.read.all") ? {} : { mdaId: actor.mdaId ?? "__none__" }, filter.departmentId ? { project: { departmentId: filter.departmentId } } : {}, rangeWhere("createdAt", r)] }, select: { rating: true } }),
    prisma.project.count({ where: { AND: [projectScope(actor), deptP, OPEN_PROJECT] } }),
  ]);
  const reviewDays = decided.map((d) => workingDaysBetween(d.submittedAt!, d.decidedAt!, cal));
  const approvalDays = approvals.filter((a) => a.history[0]).map((a) => workingDaysBetween(a.history[0].createdAt, a.decidedAt!, cal));
  const exec = closed.filter((p) => p.startedAt && (p.acceptedAt ?? p.closedAt)).map((p) => ((p.acceptedAt ?? p.closedAt)!.getTime() - p.startedAt!.getTime()) / 86400000);
  const withPlan = closed.filter((p) => p.plannedEndDate && (p.actualEndDate ?? p.closedAt));
  const onTime = withPlan.filter((p) => (p.actualEndDate ?? p.closedAt)!.getTime() <= p.plannedEndDate!.getTime() + 86400000).length;
  const accepted = acceptance.filter((a) => a.outcome === "ACCEPTED").length;
  const reopened = closed.filter((p) => p.remediationCount > 0).length;

  return [
    { key: "median_review_time", label: "Median request review time", value: r1(median(reviewDays)), unit: "working days", sampleSize: reviewDays.length, definition: "Median working days from submission to final decision (approved or rejected) for requests decided in the period. Includes time awaiting MDA information; see SLA views for paused-time exclusion." },
    { key: "approval_turnaround", label: "Approval turnaround", value: r1(median(approvalDays)), unit: "working days", sampleSize: approvalDays.length, definition: "Median working days from the last entry into Approval Review to the final approval decision." },
    { key: "avg_execution", label: "Average project execution duration", value: r1(exec.length ? exec.reduce((a, b) => a + b, 0) / exec.length : null), unit: "calendar days", sampleSize: exec.length, definition: "Mean calendar days from implementation start to MDA acceptance (or closure) for projects closed in the period." },
    { key: "on_time_rate", label: "On-time completion rate", value: withPlan.length ? Math.round((onTime / withPlan.length) * 100) : null, unit: "%", sampleSize: withPlan.length, definition: "Share of closed projects with a planned completion date whose actual completion was no more than one day after the plan (including approved schedule changes)." },
    { key: "overdue_projects", label: "Overdue projects", value: overdue, unit: "projects", sampleSize: overdue, definition: "Open projects (not accepted, closed or cancelled) whose planned completion date has passed. Point-in-time; not filtered by period." },
    { key: "acceptance_rate", label: "MDA first-decision acceptance rate", value: acceptance.length ? Math.round((accepted / acceptance.length) * 100) : null, unit: "%", sampleSize: acceptance.length, definition: "Accepted decisions as a share of all MDA accept/reject/incomplete decisions in the period (clarification requests excluded)." },
    { key: "reopened_rate", label: "Reopened (remediated) project rate", value: closed.length ? Math.round((reopened / closed.length) * 100) : null, unit: "%", sampleSize: closed.length, definition: "Share of projects closed in the period that went through at least one remediation cycle after an MDA dispute." },
    { key: "backlog", label: "Open project backlog", value: openBacklog, unit: "projects", sampleSize: openBacklog, definition: "Projects currently open (approved through awaiting MDA acceptance). Point-in-time." },
    { key: "satisfaction", label: "MDA satisfaction", value: ratings.length ? r1(ratings.reduce((a, b) => a + b.rating, 0) / ratings.length) : null, unit: "/ 5", sampleSize: ratings.length, definition: "Mean rating (1–5) submitted by MDA users on accepted projects in the period. Small samples are not representative." },
  ];
}

// ---------------------------------------------------------------------------
// Statewide intelligence map (per-MDA aggregates; no geography is assumed)
// ---------------------------------------------------------------------------

export async function mdaIntelligence(actor: Actor) {
  const mdas = await prisma.mda.findMany({ where: { AND: [mdaScope(actor), { status: { in: ["ACTIVE", "SUSPENDED", "APPROVED"] } }] }, select: { id: true, name: true, abbreviation: true, category: true }, orderBy: { name: "asc" } });
  const ids = mdas.map((m) => m.id);
  const [req, open, proj, closed, overdue] = await Promise.all([
    prisma.serviceRequest.groupBy({ by: ["mdaId"], where: { AND: [requestScope(actor), { mdaId: { in: ids }, status: { not: "DRAFT" } }] }, _count: { _all: true } }),
    prisma.serviceRequest.groupBy({ by: ["mdaId"], where: { AND: [requestScope(actor), { mdaId: { in: ids }, status: { in: OPEN_REVIEW_STATUSES } }] }, _count: { _all: true } }),
    prisma.project.groupBy({ by: ["mdaId"], where: { AND: [projectScope(actor), { mdaId: { in: ids } }] }, _count: { _all: true } }),
    prisma.project.groupBy({ by: ["mdaId"], where: { AND: [projectScope(actor), { mdaId: { in: ids }, status: "CLOSED" }] }, _count: { _all: true } }),
    prisma.project.groupBy({ by: ["mdaId"], where: { AND: [projectScope(actor), { mdaId: { in: ids } }, overdueProjectWhere()] }, _count: { _all: true } }),
  ]);
  const g = (rows: { mdaId: string; _count: { _all: number } }[], id: string) => rows.find((r) => r.mdaId === id)?._count._all ?? 0;
  return mdas.map((m) => {
    const projects = g(proj, m.id);
    const done = g(closed, m.id);
    return {
      ...m, requests: g(req, m.id), openRequests: g(open, m.id), projects, closedProjects: done, overdueProjects: g(overdue, m.id),
      completionRate: projects ? Math.round((done / projects) * 100) : null,
    };
  });
}

/** Demand analysis: requests per category per quarter (server-side grouping). */
export async function demandByCategoryAndQuarter(actor: Actor, quarters = 4) {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - quarters * 3);
  const rows = await prisma.serviceRequest.findMany({
    where: { AND: [requestScope(actor), { submittedAt: { gte: since } }] },
    select: { submittedAt: true, estimatedEffortDays: true, service: { select: { category: { select: { name: true } } } } },
  });
  const out = new Map<string, { category: string; quarter: string; count: number; effortDays: number }>();
  for (const r of rows) {
    const d = r.submittedAt!;
    const q = `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    const key = `${r.service.category.name}|${q}`;
    const cur = out.get(key) ?? { category: r.service.category.name, quarter: q, count: 0, effortDays: 0 };
    cur.count++;
    cur.effortDays += r.estimatedEffortDays ?? 0;
    out.set(key, cur);
  }
  return [...out.values()].sort((a, b) => a.quarter.localeCompare(b.quarter) || b.count - a.count);
}
