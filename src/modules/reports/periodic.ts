import { prisma } from "@/lib/db";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { audit } from "@/modules/audit/audit";
import type { Actor } from "@/modules/rbac/actor";
import { assertCan, can } from "@/modules/rbac/authorize";
import { projectScope, requestScope } from "@/modules/rbac/scope";
import {
  demandByCategoryAndQuarter, departmentBacklog, monthlyTrends, officerWorkload, overview, requestsByCategory, requestsByStatus, scorecard, unresolvedRequestsByMda,
} from "@/modules/analytics/metrics";
import { dataQualityReport } from "@/modules/quality/data-quality";

/** Government Reporting Center templates. All figures come from scoped analytics queries. */
export const REPORT_TEMPLATES = {
  EXECUTIVE_SUMMARY: { label: "Executive summary", needs: [] as string[] },
  MONTHLY_SERVICE_DELIVERY: { label: "Monthly service delivery", needs: ["month"] },
  QUARTERLY_PERFORMANCE: { label: "Quarterly performance", needs: ["quarter"] },
  ANNUAL_ICT_ACTIVITY: { label: "Annual ICT activity", needs: ["year"] },
  MDA_DELIVERY: { label: "MDA-specific delivery", needs: ["mdaId"] },
  DEPARTMENTAL_WORKLOAD: { label: "Departmental workload", needs: ["departmentId"] },
  AUDIT_COMPLIANCE: { label: "Audit and compliance", needs: ["from", "to"] },
  DEMAND_FORECAST: { label: "Service demand analysis and outlook", needs: [] },
} as const;
export type ReportTemplate = keyof typeof REPORT_TEMPLATES;

export interface ReportParams {
  month?: string; // YYYY-MM
  quarter?: string; // YYYY-Qn
  year?: string;
  mdaId?: string;
  departmentId?: string;
  from?: string;
  to?: string;
}

function period(t: ReportTemplate, p: ReportParams): { from?: Date; to?: Date; label: string } {
  if (t === "MONTHLY_SERVICE_DELIVERY") {
    if (!/^\d{4}-\d{2}$/.test(p.month ?? "")) throw new AppError("Select a month.");
    const [y, m] = p.month!.split("-").map(Number);
    return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1) - 1), label: p.month! };
  }
  if (t === "QUARTERLY_PERFORMANCE") {
    const m = (p.quarter ?? "").match(/^(\d{4})-Q([1-4])$/);
    if (!m) throw new AppError("Select a quarter.");
    const y = Number(m[1]);
    const q = Number(m[2]);
    return { from: new Date(Date.UTC(y, (q - 1) * 3, 1)), to: new Date(Date.UTC(y, q * 3, 1) - 1), label: p.quarter! };
  }
  if (t === "ANNUAL_ICT_ACTIVITY") {
    if (!/^\d{4}$/.test(p.year ?? "")) throw new AppError("Select a year.");
    const y = Number(p.year);
    return { from: new Date(Date.UTC(y, 0, 1)), to: new Date(Date.UTC(y + 1, 0, 1) - 1), label: p.year! };
  }
  if (p.from || p.to) {
    const from = p.from ? new Date(p.from) : undefined;
    const to = p.to ? new Date(p.to) : undefined;
    return { from, to, label: `${p.from ?? "start"} to ${p.to ?? "today"}` };
  }
  return { label: "All time to date" };
}

export async function generatePeriodicReport(actor: Actor, template: ReportTemplate, params: ReportParams) {
  assertCan(actor, "report.generate");
  if (!(template in REPORT_TEMPLATES)) throw new AppError("Unknown report template.");
  const range = period(template, params);
  const r = { from: range.from, to: range.to };
  let sections: Record<string, unknown> = {};
  let title = `${REPORT_TEMPLATES[template].label} — ${range.label}`;

  switch (template) {
    case "EXECUTIVE_SUMMARY":
    case "MONTHLY_SERVICE_DELIVERY":
    case "QUARTERLY_PERFORMANCE":
    case "ANNUAL_ICT_ACTIVITY":
      sections = {
        overview: await overview(actor, r), requestsByStatus: await requestsByStatus(actor, r), requestsByCategory: await requestsByCategory(actor, r),
        scorecard: await scorecard(actor, r), departmentBacklog: await departmentBacklog(actor), unresolvedByMda: await unresolvedRequestsByMda(actor, 10),
        ...(template === "ANNUAL_ICT_ACTIVITY" ? { monthlyTrends: await monthlyTrends(actor, 12) } : {}),
        closedProjects: await prisma.project.findMany({ where: { AND: [projectScope(actor), { status: "CLOSED" }, r.from || r.to ? { closedAt: { gte: r.from, lte: r.to } } : {}] }, select: { reference: true, title: true, closedAt: true, mda: { select: { abbreviation: true } } }, orderBy: { closedAt: "desc" }, take: 100 }),
      };
      break;
    case "MDA_DELIVERY": {
      if (!params.mdaId) throw new AppError("Select an MDA.");
      if (actor.userType === "MDA_USER" && params.mdaId !== actor.mdaId) throw new ForbiddenError();
      const mda = await prisma.mda.findUnique({ where: { id: params.mdaId }, select: { name: true } });
      if (!mda) throw new NotFoundError();
      title = `${REPORT_TEMPLATES[template].label} — ${mda.name}`;
      sections = {
        requests: await prisma.serviceRequest.findMany({ where: { AND: [requestScope(actor), { mdaId: params.mdaId, status: { not: "DRAFT" } }] }, select: { reference: true, title: true, status: true, submittedAt: true }, orderBy: { submittedAt: "desc" }, take: 200 }),
        projects: await prisma.project.findMany({ where: { AND: [projectScope(actor), { mdaId: params.mdaId }] }, select: { reference: true, title: true, status: true, progressPercent: true, plannedEndDate: true, closedAt: true }, orderBy: { createdAt: "desc" }, take: 200 }),
        feedback: await prisma.feedback.aggregate({ where: { mdaId: params.mdaId }, _avg: { rating: true }, _count: true }),
      };
      break;
    }
    case "DEPARTMENTAL_WORKLOAD": {
      if (!params.departmentId) throw new AppError("Select a department.");
      const dept = await prisma.department.findUnique({ where: { id: params.departmentId }, select: { name: true } });
      if (!dept) throw new NotFoundError();
      if (!can(actor, "report.read.all") && !actor.headOfDepartmentIds.includes(params.departmentId) && actor.departmentId !== params.departmentId) throw new ForbiddenError();
      title = `${REPORT_TEMPLATES[template].label} — ${dept.name}`;
      sections = { officers: await officerWorkload(actor, params.departmentId), scorecard: await scorecard(actor, r, { departmentId: params.departmentId }) };
      break;
    }
    case "AUDIT_COMPLIANCE": {
      assertCan(actor, "audit.read");
      const where = r.from || r.to ? { createdAt: { gte: r.from, lte: r.to } } : {};
      const actions = await prisma.auditEvent.groupBy({ by: ["action"], where, _count: { _all: true }, orderBy: { _count: { action: "desc" } }, take: 50 });
      sections = {
        auditActivity: actions.map((a) => ({ action: a.action, count: a._count._all })),
        exceptionalClosures: await prisma.projectClosure.findMany({ where: { closureType: "EXCEPTIONAL", ...(r.from || r.to ? { closedAt: { gte: r.from, lte: r.to } } : {}) }, select: { justification: true, closedAt: true, project: { select: { reference: true } }, closedBy: { select: { name: true } } } }),
        dataQuality: (await dataQualityReport(actor)).checks.map((c) => ({ check: c.label, issues: c.items.length })),
        lockedAccounts: await prisma.auditEvent.count({ where: { ...where, action: "auth.account_locked" } }),
      };
      break;
    }
    case "DEMAND_FORECAST": {
      const demand = await demandByCategoryAndQuarter(actor, 8);
      // Outlook = simple average of the last two complete quarters per category. Labelled as indicative, not a forecast model.
      const byCat = new Map<string, number[]>();
      for (const d of demand) byCat.set(d.category, [...(byCat.get(d.category) ?? []), d.count]);
      sections = {
        demandByQuarter: demand,
        outlook: [...byCat.entries()].map(([category, counts]) => ({ category, indicativeNextQuarter: counts.length >= 2 ? Math.round((counts[counts.length - 1] + counts[counts.length - 2]) / 2) : null, basis: counts.length >= 2 ? "Mean of the two most recent quarters" : "Insufficient history" })),
        method: "Indicative outlook only: mean of the two most recent quarters. Not a validated statistical forecast.",
      };
      break;
    }
  }
  const last = await prisma.reportRecord.findFirst({ where: { type: template, projectId: null, title }, orderBy: { version: "desc" } });
  const rec = await prisma.reportRecord.create({
    data: { type: template, title, version: (last?.version ?? 0) + 1, parameters: params as never, data: { generatedAt: new Date().toISOString(), period: range.label, sections } as never, generatedById: actor.id },
  });
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "report.generated", entityType: "ReportRecord", entityId: rec.id, after: { type: template, params } });
  return rec;
}

export async function listReports(actor: Actor) {
  if (!can(actor, "report.read.all") && !can(actor, "report.generate") && !can(actor, "report.read.mda")) throw new ForbiddenError();
  const where = can(actor, "report.read.all")
    ? {}
    : { OR: [{ generatedById: actor.id }, { project: projectScope(actor) }] };
  return prisma.reportRecord.findMany({ where, orderBy: { generatedAt: "desc" }, take: 100, select: { id: true, type: true, title: true, version: true, status: true, generatedAt: true, projectId: true, generatedBy: { select: { name: true } } } });
}

export async function getReport(actor: Actor, id: string) {
  const rep = await prisma.reportRecord.findUnique({ where: { id }, include: { generatedBy: { select: { name: true } }, finalizedBy: { select: { name: true } }, project: { select: { id: true, reference: true } } } });
  if (!rep) throw new NotFoundError();
  if (rep.projectId) {
    const ok = await prisma.project.findFirst({ where: { AND: [{ id: rep.projectId }, projectScope(actor)] }, select: { id: true } });
    if (!ok) throw new NotFoundError();
  } else if (!can(actor, "report.read.all") && rep.generatedById !== actor.id) {
    throw new NotFoundError();
  }
  return rep;
}

export async function finalizeReport(actor: Actor, id: string, summary: string) {
  assertCan(actor, "report.finalize");
  const rep = await getReport(actor, id);
  if (rep.status === "FINAL") throw new AppError("This report version is already final.");
  if (!summary?.trim()) throw new AppError("Provide the reviewed summary text before finalising.");
  await prisma.reportRecord.update({ where: { id }, data: { status: "FINAL", summary: summary.trim(), finalizedById: actor.id, finalizedAt: new Date() } });
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "report.finalized", entityType: "ReportRecord", entityId: id });
}
