import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "./actor";
import { actorDepartmentIds, can } from "./authorize";

/**
 * Row-level authorization filters. Every list/detail query for requests and
 * projects MUST be combined with these filters (AND), so that identifiers
 * supplied by the browser can never reach records outside the actor's scope.
 * An empty OR list yields a filter that matches nothing.
 */

const NOTHING = { id: { in: [] as string[] } };

export function requestScope(actor: Actor): Prisma.ServiceRequestWhereInput {
  if (can(actor, "request.read.all")) return {};
  const or: Prisma.ServiceRequestWhereInput[] = [];
  const depts = actorDepartmentIds(actor);
  if (can(actor, "request.read.department") && depts.length) {
    or.push({ assignedDepartmentId: { in: depts } }, { project: { departmentId: { in: depts } } });
  }
  if (can(actor, "request.read.mda") && actor.mdaId) or.push({ mdaId: actor.mdaId });
  if (can(actor, "request.read.own")) {
    // MDA staff: own requests within their own MDA only.
    or.push(actor.mdaId ? { createdById: actor.id, mdaId: actor.mdaId } : { createdById: actor.id });
  }
  if (can(actor, "project.read.assigned")) {
    or.push({ project: { assignments: { some: { assigneeId: actor.id, status: { in: ["PENDING_ACKNOWLEDGMENT", "ACKNOWLEDGED"] } } } } });
    or.push({ assessorId: actor.id });
  }
  // KATDICT staff without department-wide read can still see requests where they are assessor.
  if (actor.userType === "KATDICT_STAFF") or.push({ assessorId: actor.id });
  // Drafts are only ever visible to their creator.
  const scoped: Prisma.ServiceRequestWhereInput = or.length ? { OR: or } : NOTHING;
  return { AND: [scoped, { OR: [{ status: { not: "DRAFT" } }, { createdById: actor.id }] }] };
}

export function projectScope(actor: Actor): Prisma.ProjectWhereInput {
  if (can(actor, "project.read.all")) return {};
  const or: Prisma.ProjectWhereInput[] = [];
  const depts = actorDepartmentIds(actor);
  if (can(actor, "project.read.department") && depts.length) or.push({ departmentId: { in: depts } });
  if (can(actor, "project.read.mda") && actor.mdaId) {
    if (can(actor, "request.read.mda")) or.push({ mdaId: actor.mdaId });
    else or.push({ mdaId: actor.mdaId, request: { createdById: actor.id } });
  }
  if (can(actor, "project.read.assigned")) {
    or.push({ projectManagerId: actor.id });
    or.push({ assignments: { some: { assigneeId: actor.id, status: { in: ["PENDING_ACKNOWLEDGMENT", "ACKNOWLEDGED"] } } } });
  }
  return or.length ? { OR: or } : (NOTHING as Prisma.ProjectWhereInput);
}

export function mdaScope(actor: Actor): Prisma.MdaWhereInput {
  if (can(actor, "mda.read.all") || can(actor, "mda.review")) return {};
  if (actor.mdaId) return { id: actor.mdaId };
  // KATDICT staff without MDA-wide access may see MDAs of projects they work on.
  if (actor.userType === "KATDICT_STAFF") return { projects: { some: projectScope(actor) } };
  return { id: { in: [] } };
}

export function complaintScope(actor: Actor): Prisma.ComplaintWhereInput {
  if (can(actor, "complaint.read.all")) return {};
  if (actor.mdaId && can(actor, "complaint.submit")) {
    return can(actor, "request.read.mda") ? { mdaId: actor.mdaId } : { mdaId: actor.mdaId, raisedById: actor.id };
  }
  return { assignedToId: actor.id };
}

/** Whether the actor may see INTERNAL comments/attachments on projects. */
export function canSeeInternal(actor: Actor): boolean {
  return actor.userType !== "MDA_USER" && (can(actor, "project.comment.internal") || can(actor, "audit.read"));
}
