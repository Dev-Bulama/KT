import { prisma } from "@/lib/db";
import type { Actor } from "@/modules/rbac/actor";
import { assertCan } from "@/modules/rbac/authorize";
import { projectScope } from "@/modules/rbac/scope";

/**
 * Data Quality Centre. Each check returns the affected records with a link to
 * the normal (audited) correction workflow; nothing is auto-corrected.
 */
export async function dataQualityReport(actor: Actor) {
  assertCan(actor, "dataquality.view");
  const ps = projectScope(actor);
  const [mdasMissing, closedNoReport, closedNoClosure, activeUnassigned, inconsistentDates, approvedNoDecision, acceptedWithoutDecision, closedWithOpenTasks, noDeliverables] = await Promise.all([
    prisma.mda.findMany({ where: { status: { in: ["ACTIVE", "APPROVED"] }, OR: [{ officialEmail: null }, { officialPhone: null }, { address: null }, { ictContactName: null }] }, select: { id: true, name: true, officialEmail: true, officialPhone: true, address: true, ictContactName: true }, take: 200 }),
    prisma.project.findMany({ where: { AND: [ps, { status: "CLOSED", reports: { none: {} } }] }, select: { id: true, reference: true, title: true }, take: 200 }),
    prisma.project.findMany({ where: { AND: [ps, { status: "CLOSED", closure: null }] }, select: { id: true, reference: true, title: true }, take: 200 }),
    prisma.project.findMany({ where: { AND: [ps, { status: { in: ["IN_PROGRESS", "ASSIGNED", "AWAITING_ACKNOWLEDGMENT", "BLOCKED", "ON_HOLD"] }, projectManagerId: null }] }, select: { id: true, reference: true, title: true, status: true }, take: 200 }),
    prisma.$queryRaw<{ id: string; reference: string; title: string; issue: string }[]>`
      SELECT id, reference, title,
        CASE WHEN "plannedEndDate" < "startDate" THEN 'Planned end before start'
             WHEN "closedAt" < "startedAt" THEN 'Closed before started'
             WHEN "acceptedAt" < "completionSubmittedAt" THEN 'Accepted before completion submitted'
             ELSE 'Inconsistent dates' END AS issue
      FROM "Project"
      WHERE ("plannedEndDate" < "startDate") OR ("closedAt" < "startedAt") OR ("acceptedAt" < "completionSubmittedAt")
      LIMIT 200`,
    prisma.serviceRequest.findMany({ where: { status: { in: ["APPROVED", "PROJECT_INITIATED"] }, approvalDecisions: { none: { outcome: "APPROVED" } } }, select: { id: true, reference: true, title: true }, take: 200 }),
    prisma.project.findMany({ where: { AND: [ps, { status: { in: ["ACCEPTED", "CLOSED"] }, acceptanceDecisions: { none: { outcome: "ACCEPTED" } }, closure: { is: { closureType: "STANDARD" } } }] }, select: { id: true, reference: true, title: true }, take: 200 }),
    prisma.project.findMany({ where: { AND: [ps, { status: "CLOSED", tasks: { some: { status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] } } } }] }, select: { id: true, reference: true, title: true }, take: 200 }),
    prisma.project.findMany({ where: { AND: [ps, { status: { in: ["IN_PROGRESS", "UNDER_REVIEW"] }, deliverables: { none: {} } }] }, select: { id: true, reference: true, title: true }, take: 200 }),
  ]);
  // Possible duplicate MDAs: normalised-name comparison in application code (small table).
  const all = await prisma.mda.findMany({ select: { id: true, name: true, abbreviation: true } });
  const norm = (s: string) => s.toLowerCase().replace(/\b(ministry|of|and|the|state|katsina|agency|board|commission)\b/g, "").replace(/[^a-z]/g, "");
  const dupes: { a: { id: string; name: string }; b: { id: string; name: string } }[] = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const na = norm(all[i].name);
    if (na.length > 3 && na === norm(all[j].name)) dupes.push({ a: all[i], b: all[j] });
  }
  return {
    checks: [
      { key: "mda_missing", label: "MDAs with missing contact information", items: mdasMissing.map((m) => ({ id: m.id, href: `/mdas/${m.id}`, label: m.name, detail: ["officialEmail", "officialPhone", "address", "ictContactName"].filter((k) => !(m as Record<string, unknown>)[k]).join(", ") })) },
      { key: "mda_duplicates", label: "Possible duplicate MDA records", items: dupes.map((d) => ({ id: `${d.a.id}-${d.b.id}`, href: `/mdas/${d.a.id}`, label: `${d.a.name} ↔ ${d.b.name}`, detail: "Names match after normalisation" })) },
      { key: "closed_no_report", label: "Closed projects without a completion report", items: closedNoReport.map((p) => ({ id: p.id, href: `/projects/${p.id}`, label: `${p.reference} ${p.title}`, detail: "Generate the report from the project page" })) },
      { key: "closed_no_closure", label: "Closed projects without a closure record", items: closedNoClosure.map((p) => ({ id: p.id, href: `/projects/${p.id}`, label: `${p.reference} ${p.title}`, detail: "Invalid status combination" })) },
      { key: "unassigned", label: "Active projects without a project manager", items: activeUnassigned.map((p) => ({ id: p.id, href: `/projects/${p.id}`, label: `${p.reference} ${p.title}`, detail: p.status })) },
      { key: "dates", label: "Inconsistent project dates", items: inconsistentDates.map((p) => ({ id: p.id, href: `/projects/${p.id}`, label: `${p.reference} ${p.title}`, detail: p.issue })) },
      { key: "approval_missing", label: "Approved requests without an approval decision record", items: approvedNoDecision.map((r) => ({ id: r.id, href: `/requests/${r.id}`, label: `${r.reference} ${r.title}`, detail: "Missing approval record" })) },
      { key: "acceptance_missing", label: "Accepted/closed projects without an MDA acceptance record", items: acceptedWithoutDecision.map((p) => ({ id: p.id, href: `/projects/${p.id}`, label: `${p.reference} ${p.title}`, detail: "Missing acceptance record" })) },
      { key: "open_tasks_closed", label: "Closed projects with open tasks", items: closedWithOpenTasks.map((p) => ({ id: p.id, href: `/projects/${p.id}`, label: `${p.reference} ${p.title}`, detail: "Incomplete project documentation" })) },
      { key: "no_deliverables", label: "In-progress projects with no deliverables defined", items: noDeliverables.map((p) => ({ id: p.id, href: `/projects/${p.id}`, label: `${p.reference} ${p.title}`, detail: "Define deliverables" })) },
    ],
  };
}
