import type { Prisma } from "@/generated/prisma/client";
import { prisma, type Db } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { Actor } from "@/modules/rbac/actor";
import { actorDepartmentIds, can } from "@/modules/rbac/authorize";
import { projectScope } from "@/modules/rbac/scope";

const ACTIVE_ASSIGNMENT = { in: ["PENDING_ACKNOWLEDGMENT", "ACKNOWLEDGED"] as ("PENDING_ACKNOWLEDGMENT" | "ACKNOWLEDGED")[] };

/** Loads a project only if it is inside the actor's scope (prevents IDOR). */
export async function loadScopedProject<T extends Prisma.ProjectInclude>(db: Db, actor: Actor, id: string, include?: T) {
  const p = await db.project.findFirst({ where: { AND: [{ id }, projectScope(actor)] }, include: include as T });
  if (!p) throw new NotFoundError();
  return p as Prisma.ProjectGetPayload<{ include: T }>;
}

export async function isAssignedToProject(db: Db, actorId: string, projectId: string): Promise<boolean> {
  const p = await db.project.findFirst({
    where: { id: projectId, OR: [{ projectManagerId: actorId }, { assignments: { some: { assigneeId: actorId, status: ACTIVE_ASSIGNMENT } } }] },
    select: { id: true },
  });
  return !!p;
}

/**
 * Whether the actor may perform delivery updates on the project: requires
 * project.update AND (assigned to it, OR head of its department, OR holds
 * project.manage). MDA and oversight users never qualify.
 */
export async function canWorkOnProject(db: Db, actor: Actor, project: { id: string; departmentId: string | null }): Promise<boolean> {
  if (actor.userType !== "KATDICT_STAFF" || !can(actor, "project.update")) return false;
  if (can(actor, "project.manage")) return true;
  if (project.departmentId && actor.headOfDepartmentIds.includes(project.departmentId)) return true;
  return isAssignedToProject(db, actor.id, project.id);
}

export async function assertCanWorkOnProject(db: Db, actor: Actor, project: { id: string; departmentId: string | null }) {
  if (!(await canWorkOnProject(db, actor, project))) throw new ForbiddenError("Only the assigned project team can update this project.");
}

/** Whether the actor can assign people on this project (global, or department head of the project's department). */
export function canAssignOnProject(actor: Actor, project: { departmentId: string | null }): "global" | "department" | false {
  if (actor.userType !== "KATDICT_STAFF") return false;
  if (can(actor, "project.assign")) return "global";
  if (can(actor, "project.assign.department") && project.departmentId && actorDepartmentIds(actor).includes(project.departmentId)) {
    return actor.headOfDepartmentIds.includes(project.departmentId) ? "department" : false;
  }
  return false;
}

export { prisma };
