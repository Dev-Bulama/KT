import { prisma } from "@/lib/db";
import type { Actor } from "@/modules/rbac/actor";
import { can } from "@/modules/rbac/authorize";
import { canSeeInternal, mdaScope, projectScope, requestScope } from "@/modules/rbac/scope";
import { searchKnowledge } from "@/modules/knowledge/service";

export interface SearchHit {
  type: "Request" | "Project" | "MDA" | "Milestone" | "Knowledge" | "Service" | "Officer" | "Document";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/**
 * Global search. Authorisation filters are part of every query's WHERE
 * clause, so unauthorised records never appear in results or snippets.
 */
export async function globalSearch(actor: Actor, raw: string): Promise<SearchHit[]> {
  const q = raw.trim().slice(0, 100);
  if (q.length < 2) return [];
  const like = { contains: q, mode: "insensitive" as const };
  const internal = canSeeInternal(actor);
  const [requests, projects, mdas, milestones, services, officers, docs] = await Promise.all([
    prisma.serviceRequest.findMany({ where: { AND: [requestScope(actor), { OR: [{ reference: like }, { title: like }, { service: { name: like } }, { service: { category: { name: like } } }] }] }, select: { id: true, reference: true, title: true, status: true, mda: { select: { abbreviation: true } } }, take: 8 }),
    prisma.project.findMany({ where: { AND: [projectScope(actor), { OR: [{ reference: like }, { title: like }, ...(internal ? [{ projectManager: { name: like } }] : [])] }] }, select: { id: true, reference: true, title: true, status: true }, take: 8 }),
    prisma.mda.findMany({ where: { AND: [mdaScope(actor), { status: { not: "DIRECTORY" } }, { OR: [{ name: like }, { abbreviation: like }] }] }, select: { id: true, name: true, abbreviation: true, status: true }, take: 6 }),
    prisma.projectMilestone.findMany({ where: { title: like, project: projectScope(actor), ...(internal ? {} : { visibleToMda: true }) }, select: { id: true, title: true, project: { select: { id: true, reference: true } } }, take: 6 }),
    prisma.serviceDefinition.findMany({ where: { active: true, OR: [{ name: like }, { category: { name: like } }] }, select: { id: true, name: true, category: { select: { name: true } } }, take: 5 }),
    actor.userType === "KATDICT_STAFF" && can(actor, "user.read")
      ? prisma.user.findMany({ where: { userType: "KATDICT_STAFF", status: "ACTIVE", name: like }, select: { id: true, name: true, department: { select: { name: true } } }, take: 5 })
      : Promise.resolve([]),
    prisma.attachment.findMany({
      where: {
        originalName: like, scanStatus: { not: "QUARANTINED" }, ...(internal ? {} : { visibility: "MDA_VISIBLE" as const }),
        OR: [{ request: requestScope(actor) }, { project: projectScope(actor) }],
      },
      select: { id: true, originalName: true, requestId: true, projectId: true }, take: 5,
    }),
  ]);
  const kb = can(actor, "knowledge.read") ? await searchKnowledge(actor, q, undefined, 5) : [];
  return [
    ...requests.map((r) => ({ type: "Request" as const, id: r.id, title: `${r.reference ?? "Draft"} — ${r.title}`, subtitle: `${r.mda.abbreviation} · ${r.status.replace(/_/g, " ")}`, href: `/requests/${r.id}` })),
    ...projects.map((p) => ({ type: "Project" as const, id: p.id, title: `${p.reference} — ${p.title}`, subtitle: p.status.replace(/_/g, " "), href: `/projects/${p.id}` })),
    ...mdas.map((m) => ({ type: "MDA" as const, id: m.id, title: m.name, subtitle: `${m.abbreviation} · ${m.status}`, href: `/mdas/${m.id}` })),
    ...milestones.map((m) => ({ type: "Milestone" as const, id: m.id, title: m.title, subtitle: m.project.reference, href: `/projects/${m.project.id}?tab=plan` })),
    ...services.map((s) => ({ type: "Service" as const, id: s.id, title: s.name, subtitle: s.category.name, href: `/services#${s.id}` })),
    ...officers.map((o) => ({ type: "Officer" as const, id: o.id, title: o.name, subtitle: o.department?.name ?? "KATDICT", href: `/admin/users?q=${encodeURIComponent(o.name)}` })),
    ...docs.map((d) => ({ type: "Document" as const, id: d.id, title: d.originalName, subtitle: "Approved document", href: d.requestId ? `/requests/${d.requestId}` : `/projects/${d.projectId}?tab=files` })),
    ...kb.map((k) => ({ type: "Knowledge" as const, id: k.id, title: k.title, subtitle: k.category.replace(/_/g, " "), href: `/knowledge/${k.id}` })),
  ];
}
