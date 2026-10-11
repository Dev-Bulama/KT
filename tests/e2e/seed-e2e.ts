import { prisma } from "../../src/lib/db";
import { hashPassword } from "../../src/modules/auth/password";
import { seedBase } from "../../prisma/seed-lib";

export const E2E_PASSWORD = "E2e-Passw0rd-2026";
export const STAFF = {
  ops: { email: "ops@e2e.katdict.test", role: "OPERATIONS_ADMIN" },
  reviewer: { email: "reviewer@e2e.katdict.test", role: "OPERATIONS_ADMIN" },
  head: { email: "head@e2e.katdict.test", role: "DEPARTMENT_HEAD", dept: "SWD" },
  officer: { email: "officer@e2e.katdict.test", role: "PROJECT_OFFICER", dept: "SWD" },
  auditor: { email: "auditor@e2e.katdict.test", role: "AUDITOR" },
} as const;

async function main() {
  await seedBase(prisma as never);
  await prisma.systemSetting.create({ data: { key: "security.requireMfaForPrivileged", value: false } });
  const hash = await hashPassword(E2E_PASSWORD);
  for (const [key, s] of Object.entries(STAFF)) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: s.role } });
    const dept = "dept" in s ? await prisma.department.findUniqueOrThrow({ where: { code: s.dept } }) : null;
    const u = await prisma.user.create({ data: { email: s.email, name: `E2E ${key}`, passwordHash: hash, status: "ACTIVE", userType: role.userType, emailVerifiedAt: new Date(), departmentId: dept?.id, roles: { create: { roleId: role.id } } } });
    if (s.role === "DEPARTMENT_HEAD" && dept) await prisma.department.update({ where: { id: dept.id }, data: { headId: u.id } });
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
