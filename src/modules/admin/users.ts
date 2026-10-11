import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/modules/audit/audit";
import type { Actor } from "@/modules/rbac/actor";
import { assertCan, can } from "@/modules/rbac/authorize";
import { ALL_PERMISSIONS, KATDICT_ONLY_PERMISSIONS, OVERSIGHT_FORBIDDEN_PREFIXES } from "@/modules/rbac/permissions";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function listUsers(actor: Actor, opts: { q?: string; userType?: string; status?: string; departmentId?: string; page?: number } = {}) {
  assertCan(actor, "user.read");
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = 25;
  const where: Prisma.UserWhereInput = {
    AND: [
      opts.q ? { OR: [{ name: { contains: opts.q, mode: "insensitive" } }, { email: { contains: opts.q, mode: "insensitive" } }] } : {},
      opts.userType ? { userType: opts.userType as never } : {},
      opts.status ? { status: opts.status as never } : {},
      opts.departmentId ? { departmentId: opts.departmentId } : {},
    ],
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where, orderBy: { name: "asc" }, skip: (page - 1) * pageSize, take: pageSize,
      select: {
        id: true, name: true, email: true, userType: true, status: true, lastLoginAt: true, mfaEnabled: true, skills: true, maxConcurrentProjects: true,
        department: { select: { id: true, name: true } }, membership: { select: { mda: { select: { name: true, abbreviation: true } } } },
        roles: { select: { role: { select: { key: true, name: true } } } },
      },
    }),
    prisma.user.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function setUserRoles(actor: Actor, userId: string, roleKeys: string[]) {
  assertCan(actor, "role.assign");
  if (userId === actor.id) throw new ForbiddenError("You cannot change your own roles.");
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: true } } } });
  if (!user) throw new NotFoundError();
  const roles = await prisma.role.findMany({ where: { key: { in: roleKeys } } });
  if (roles.length !== roleKeys.length) throw new ValidationError("Unknown role.");
  if (roles.some((r) => r.userType !== user.userType)) throw new ValidationError("Selected roles do not match the user's account type.");
  const touchesSuper = roleKeys.includes("SUPER_ADMIN") || user.roles.some((r) => r.role.key === "SUPER_ADMIN");
  if (touchesSuper && !actor.roles.includes("SUPER_ADMIN")) throw new ForbiddenError("Only a Super Administrator can grant or remove the Super Administrator role.");
  if (user.userType === "MDA_USER" && !can(actor, "mda.manage")) throw new ForbiddenError("MDA user roles are managed by the MDA administrator.");
  // Prevent removing the last active Super Administrator.
  if (user.roles.some((r) => r.role.key === "SUPER_ADMIN") && !roleKeys.includes("SUPER_ADMIN")) {
    const supers = await prisma.user.count({ where: { status: "ACTIVE", roles: { some: { role: { key: "SUPER_ADMIN" } } } } });
    if (supers <= 1) throw new AppError("At least one active Super Administrator must remain.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId } });
    await tx.userRole.createMany({ data: roles.map((r) => ({ userId, roleId: r.id, grantedById: actor.id })) });
    // Force re-authentication so new privileges (and MFA requirements) apply immediately.
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "user.roles_changed", entityType: "User", entityId: userId, before: { roles: user.roles.map((r) => r.role.key) }, after: { roles: roleKeys } });
  });
}

export async function setUserStatus(actor: Actor, userId: string, status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED", reason: string) {
  assertCan(actor, "user.manage");
  if (userId === actor.id) throw new ForbiddenError("You cannot change your own account status.");
  if (!reason?.trim()) throw new ValidationError("A reason is required.");
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: true } } } });
  if (!user) throw new NotFoundError();
  if (user.roles.some((r) => r.role.key === "SUPER_ADMIN") && !actor.roles.includes("SUPER_ADMIN")) throw new ForbiddenError();
  if (status !== "ACTIVE" && user.roles.some((r) => r.role.key === "SUPER_ADMIN")) {
    const supers = await prisma.user.count({ where: { status: "ACTIVE", roles: { some: { role: { key: "SUPER_ADMIN" } } } } });
    if (supers <= 1) throw new AppError("At least one active Super Administrator must remain.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { status, ...(status === "ACTIVE" ? { failedLoginCount: 0, lockedUntil: null } : {}) } });
    if (status !== "ACTIVE") await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: `user.status_${status.toLowerCase()}`, entityType: "User", entityId: userId, before: { status: user.status }, after: { status }, reason });
  });
}

export const staffProfileSchema = z.object({
  departmentId: z.string().cuid().optional().or(z.literal("").transform(() => undefined)),
  skills: z.string().optional().transform((v) => (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 30)),
  maxConcurrentProjects: z.coerce.number().int().min(1).max(50),
  availabilityNote: z.string().trim().max(500).optional(),
});

export async function updateStaffProfile(actor: Actor, userId: string, raw: unknown) {
  assertCan(actor, "user.manage");
  const parsed = staffProfileSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Please correct the highlighted fields.");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.userType !== "KATDICT_STAFF") throw new NotFoundError();
  const data = { departmentId: parsed.data.departmentId ?? null, skills: parsed.data.skills, maxConcurrentProjects: parsed.data.maxConcurrentProjects, availabilityNote: parsed.data.availabilityNote ?? null };
  await prisma.user.update({ where: { id: userId }, data });
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "user.staff_profile_updated", entityType: "User", entityId: userId, before: { departmentId: user.departmentId, skills: user.skills, maxConcurrentProjects: user.maxConcurrentProjects }, after: data });
}

// ---------------------------------------------------------------------------
// Roles and permissions
// ---------------------------------------------------------------------------

export async function listRolesWithPermissions() {
  return prisma.role.findMany({ orderBy: { name: "asc" }, include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } } });
}

/** Validates a proposed permission set for a role (pure; unit-tested). */
export function validateRolePermissions(role: { key: string; userType: string }, permissions: string[]): string[] {
  const errors: string[] = [];
  const unknown = permissions.filter((p) => !(ALL_PERMISSIONS as string[]).includes(p));
  if (unknown.length) errors.push(`Unknown permissions: ${unknown.join(", ")}`);
  if (role.userType === "MDA_USER") {
    const bad = permissions.filter((p) => (KATDICT_ONLY_PERMISSIONS as string[]).includes(p));
    if (bad.length) errors.push(`MDA roles cannot hold KATDICT permissions: ${bad.join(", ")}`);
  }
  if (role.userType === "OVERSIGHT") {
    const bad = permissions.filter((p) => OVERSIGHT_FORBIDDEN_PREFIXES.some((pre) => p.startsWith(pre)));
    if (bad.length) errors.push(`Oversight roles must remain read-only: ${bad.join(", ")}`);
  }
  if (role.key === "SUPER_ADMIN") {
    for (const req of ["role.manage", "role.assign", "user.manage", "system.settings.manage", "audit.read"]) {
      if (!permissions.includes(req)) errors.push(`The Super Administrator role must keep ${req}`);
    }
  }
  return errors;
}

export async function setRolePermissions(actor: Actor, roleId: string, permissions: string[]) {
  assertCan(actor, "role.manage");
  const role = await prisma.role.findUnique({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });
  if (!role) throw new NotFoundError();
  // Privilege-escalation guard: you cannot edit a role you hold.
  if (actor.roles.includes(role.key)) throw new ForbiddenError("You cannot change the permissions of a role you hold.");
  const unique = [...new Set(permissions)];
  const errors = validateRolePermissions(role, unique);
  if (errors.length) throw new ValidationError(errors.join(" "));
  const perms = await prisma.permission.findMany({ where: { key: { in: unique } } });
  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "role.permissions_changed", entityType: "Role", entityId: roleId, before: { permissions: role.permissions.map((p) => p.permission.key).sort() }, after: { permissions: unique.sort() } });
  });
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

export const departmentSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).optional(),
  headId: z.string().cuid().optional().or(z.literal("").transform(() => undefined)),
  active: z.coerce.boolean().default(true),
});

export async function listDepartments() {
  return prisma.department.findMany({ orderBy: { name: "asc" }, include: { head: { select: { id: true, name: true } }, _count: { select: { members: true, projects: true } } } });
}

export async function upsertDepartment(actor: Actor, id: string | null, raw: unknown) {
  assertCan(actor, "department.manage");
  const parsed = departmentSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Please correct the highlighted fields.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const d = parsed.data;
  if (d.headId) {
    const head = await prisma.user.findFirst({ where: { id: d.headId, userType: "KATDICT_STAFF", status: "ACTIVE", roles: { some: { role: { key: "DEPARTMENT_HEAD" } } } } });
    if (!head) throw new ValidationError("The department head must be an active user with the Department Head role.");
  }
  const before = id ? await prisma.department.findUnique({ where: { id } }) : null;
  const rec = id ? await prisma.department.update({ where: { id }, data: { ...d, headId: d.headId ?? null } }) : await prisma.department.create({ data: { ...d, headId: d.headId ?? null } });
  if (d.headId) await prisma.user.update({ where: { id: d.headId }, data: { departmentId: rec.id } });
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: id ? "department.updated" : "department.created", entityType: "Department", entityId: rec.id, before, after: d });
  return rec;
}
