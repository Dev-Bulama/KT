import { prisma } from "@/lib/db";
import type { Actor } from "@/modules/rbac/actor";
import { projectScope, requestScope } from "@/modules/rbac/scope";
import { getSetting } from "@/modules/settings/service";
import { OPEN_REVIEW_STATUSES } from "@/modules/requests/workflow";
import { assessProjectRisk } from "./risk";
import { clusters, jaccard, tokens } from "./similarity";

/** Risk assessment for open projects in scope (explainable rules). */
export async function projectRiskBoard(actor: Actor, limit = 50) {
  const now = new Date();
  const scopeWarn = await getSetting("workflow.scopeChangeWarningCount");
  const projects = await prisma.project.findMany({
    where: { AND: [projectScope(actor), { status: { notIn: ["CLOSED", "CANCELLED"] } }] },
    select: {
      id: true, reference: true, title: true, status: true, plannedEndDate: true, startedAt: true, progressPercent: true, remediationCount: true,
      mda: { select: { abbreviation: true } }, department: { select: { name: true } },
      milestones: { where: { status: { in: ["PENDING", "IN_PROGRESS"] }, dueDate: { lt: now } }, select: { id: true } },
      blockers: { where: { resolvedAt: null }, select: { raisedAt: true } },
      assignments: { where: { status: "PENDING_ACKNOWLEDGMENT", expectedAckBy: { lt: now } }, select: { id: true } },
      risks: { where: { status: "OPEN" }, select: { likelihood: true, impact: true } },
      _count: { select: { scopeChanges: true } },
    },
    take: 500,
  });
  return projects
    .map((p) => {
      const oldest = p.blockers.length ? Math.max(...p.blockers.map((b) => (now.getTime() - b.raisedAt.getTime()) / 86400000)) : null;
      const r = assessProjectRisk({
        status: p.status, plannedEndDate: p.plannedEndDate, startedAt: p.startedAt, progressPercent: p.progressPercent,
        overdueMilestones: p.milestones.length, openBlockers: p.blockers.length, oldestBlockerDays: oldest, scopeChanges: p._count.scopeChanges,
        pendingAckOverdue: p.assignments.length, openHighRisks: p.risks.filter((x) => x.likelihood * x.impact >= 12).length,
        remediationCount: p.remediationCount, historicalMedianDurationDays: null,
      }, now, scopeWarn);
      return { id: p.id, reference: p.reference, title: p.title, status: p.status, mda: p.mda.abbreviation, department: p.department?.name ?? null, ...r };
    })
    .filter((x) => x.flags.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Candidate duplicates for a request among other requests visible to the actor. */
export async function findSimilarRequests(actor: Actor, requestId: string, threshold = 0.25) {
  const target = await prisma.serviceRequest.findFirst({ where: { AND: [{ id: requestId }, requestScope(actor)] }, select: { id: true, title: true, problemStatement: true, desiredOutcome: true } });
  if (!target) return [];
  const others = await prisma.serviceRequest.findMany({
    where: { AND: [requestScope(actor), { id: { not: requestId }, status: { not: "DRAFT" } }] },
    select: { id: true, reference: true, title: true, problemStatement: true, desiredOutcome: true, status: true, mda: { select: { abbreviation: true } } },
    orderBy: { submittedAt: "desc" }, take: 500,
  });
  const t = tokens(`${target.title} ${target.problemStatement ?? ""} ${target.desiredOutcome ?? ""}`);
  return others
    .map((o) => ({ ...o, score: Math.round(jaccard(t, tokens(`${o.title} ${o.problemStatement ?? ""} ${o.desiredOutcome ?? ""}`)) * 100) / 100 }))
    .filter((o) => o.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ problemStatement: _p, desiredOutcome: _d, ...rest }) => rest);
}

/** Shared-solution opportunities: clusters of similar requests across ≥2 MDAs. */
export async function sharedSolutionOpportunities(actor: Actor) {
  const reqs = await prisma.serviceRequest.findMany({
    where: { AND: [requestScope(actor), { status: { notIn: ["DRAFT", "WITHDRAWN"] } }] },
    select: { id: true, reference: true, title: true, problemStatement: true, desiredOutcome: true, estimatedEffortDays: true, status: true, mdaId: true, mda: { select: { name: true, abbreviation: true } }, service: { select: { name: true, category: { select: { name: true } } } } },
    orderBy: { submittedAt: "desc" }, take: 800,
  });
  const byId = new Map(reqs.map((r) => [r.id, r]));
  const cl = clusters(reqs.map((r) => ({ id: r.id, text: `${r.title} ${r.problemStatement ?? ""} ${r.desiredOutcome ?? ""}`, group: r.mdaId })), 0.3, 2);
  return cl
    .map((c) => {
      const items = c.docs.map((d) => byId.get(d.id)!);
      const mdas = [...new Set(items.map((i) => i.mda.abbreviation))];
      const effort = items.reduce((s, i) => s + (i.estimatedEffortDays ?? 0), 0);
      const withEffort = items.filter((i) => i.estimatedEffortDays).length;
      return {
        commonTerms: c.commonTerms, mdas, requests: items.map((i) => ({ id: i.id, reference: i.reference, title: i.title, mda: i.mda.abbreviation, status: i.status, category: i.service.category.name })),
        evidence: `${items.length} requests from ${mdas.length} MDAs share key terms: ${c.commonTerms.join(", ") || "(varied wording)"}.`,
        // Indicative only: sum of separately estimated effort that a single shared solution might partly replace.
        combinedEstimatedEffortDays: withEffort ? effort : null,
      };
    })
    .sort((a, b) => b.mdas.length - a.mdas.length);
}

/** Recurring service needs: category counts of open/recent requests. */
export async function recurringNeeds(actor: Actor) {
  const rows = await prisma.serviceRequest.groupBy({ by: ["serviceId"], where: { AND: [requestScope(actor), { status: { in: [...OPEN_REVIEW_STATUSES, "APPROVED", "PROJECT_INITIATED"] } }] }, _count: { _all: true } });
  const services = await prisma.serviceDefinition.findMany({ where: { id: { in: rows.map((r) => r.serviceId) } }, select: { id: true, name: true } });
  return rows.map((r) => ({ service: services.find((s) => s.id === r.serviceId)?.name ?? "—", count: r._count._all })).sort((a, b) => b.count - a.count).slice(0, 10);
}
