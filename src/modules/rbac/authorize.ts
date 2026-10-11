import { ForbiddenError } from "@/lib/errors";
import type { Actor } from "./actor";
import type { Permission } from "./permissions";

export function can(actor: Actor | null | undefined, permission: Permission): boolean {
  return !!actor && actor.permissions.has(permission);
}

export function canAny(actor: Actor | null | undefined, permissions: Permission[]): boolean {
  return !!actor && permissions.some((p) => actor.permissions.has(p));
}

export function assertCan(actor: Actor, permission: Permission, message?: string): void {
  if (!can(actor, permission)) throw new ForbiddenError(message);
}

export function assertCanAny(actor: Actor, permissions: Permission[], message?: string): void {
  if (!canAny(actor, permissions)) throw new ForbiddenError(message);
}

export function isKatdict(actor: Actor): boolean {
  return actor.userType === "KATDICT_STAFF";
}

export function isMdaUser(actor: Actor): boolean {
  return actor.userType === "MDA_USER";
}

/** Department ids the actor can act for (own department + departments they head). */
export function actorDepartmentIds(actor: Actor): string[] {
  const ids = new Set(actor.headOfDepartmentIds);
  if (actor.departmentId) ids.add(actor.departmentId);
  return [...ids];
}
