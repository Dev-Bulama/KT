import { prisma } from "@/lib/db";
import { loadActor, type Actor } from "@/modules/rbac/actor";
import { hashPassword } from "@/modules/auth/password";
import { seedBase } from "../../prisma/seed-lib";
import type { RoleKey } from "@/modules/rbac/permissions";

/** Truncates every table (TRUNCATE bypasses the append-only row triggers) and reseeds base configuration. */
export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await seedBase(prisma as never);
  await prisma.systemSetting.create({ data: { key: "security.requireMfaForPrivileged", value: false } });
}

let n = 0;
const PASSWORD = "Test-Passw0rd-123";
let hashed: string | null = null;

export async function makeMda(abbr: string, status: "ACTIVE" | "PENDING_REVIEW" | "APPROVED" = "ACTIVE") {
  return prisma.mda.create({
    data: { name: `TEST ${abbr} Ministry`, abbreviation: abbr, category: "MINISTRY", status, address: "Test", officialEmail: `${abbr.toLowerCase()}@test.invalid`, officialPhone: "+234 800 000 0000", contactPersonName: "Contact", contactPersonDesignation: "PS", submittedAt: new Date() },
  });
}

export async function makeUser(role: RoleKey, opts: { mdaId?: string; departmentCode?: string; skills?: string[] } = {}): Promise<Actor> {
  hashed ??= await hashPassword(PASSWORD);
  const r = await prisma.role.findUniqueOrThrow({ where: { key: role } });
  const dept = opts.departmentCode ? await prisma.department.findUniqueOrThrow({ where: { code: opts.departmentCode } }) : null;
  const u = await prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${++n}@test.invalid`, name: `${role} ${n}`, passwordHash: hashed, status: "ACTIVE", userType: r.userType, emailVerifiedAt: new Date(),
      departmentId: dept?.id ?? null, skills: opts.skills ?? [], roles: { create: { roleId: r.id } },
      ...(opts.mdaId ? { membership: { create: { mdaId: opts.mdaId, isPrimaryRepresentative: role === "MDA_ADMIN" } } } : {}),
    },
  });
  if (role === "DEPARTMENT_HEAD" && dept) await prisma.department.update({ where: { id: dept.id }, data: { headId: u.id } });
  return (await actor(u.id))!;
}

export async function actor(userId: string) {
  return loadActor(prisma, userId, { id: `test-${userId}`, mfaVerified: true });
}

export const PASSWORD_FOR_TESTS = PASSWORD;

export async function serviceId(code = "WEB_APP_DEV_GENERAL") {
  return (await prisma.serviceDefinition.findUniqueOrThrow({ where: { code } })).id;
}

export const fullRequest = (svc: string, title = "Digitise registry operations") => ({
  serviceId: svc, title, urgency: "MEDIUM",
  problemStatement: "Registry files are handled manually and frequently misplaced, delaying responses to citizens by weeks.",
  desiredOutcome: "A digital registry that tracks every file movement.",
  businessJustification: "Reduces delays and improves accountability.",
  expectedDeliverables: "Registry application, user manual, training.",
  successCriteria: "90% of files tracked digitally within 3 months.",
  institutionalImpact: "Faster service delivery and better oversight.",
  consequencesOfInaction: "Continued delays and lost records.",
});

export async function version(id: string) {
  return (await prisma.serviceRequest.findUniqueOrThrow({ where: { id } })).version;
}
export async function pversion(id: string) {
  return (await prisma.project.findUniqueOrThrow({ where: { id } })).version;
}

export { prisma };
