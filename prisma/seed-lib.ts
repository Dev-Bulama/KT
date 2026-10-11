import type { PrismaClient } from "../src/generated/prisma/client";
import { ALL_PERMISSIONS, DEFAULT_ROLES, PERMISSIONS, permissionModule } from "../src/modules/rbac/permissions";
import { DEFAULT_DEPARTMENTS, DEFAULT_POLICY, DEFAULT_RULES, SERVICE_CATEGORIES } from "./catalog-data";

/**
 * Idempotent base seed: permissions, roles, departments, service catalog and
 * the default approval policy. Re-running never overwrites role permissions
 * that administrators have changed, unless `resetRoles` is true.
 */
export async function seedBase(prisma: PrismaClient, opts: { resetRoles?: boolean; log?: (m: string) => void } = {}) {
  const log = opts.log ?? (() => undefined);

  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, module: permissionModule(key), description: PERMISSIONS[key] },
      update: { module: permissionModule(key), description: PERMISSIONS[key] },
    });
  }
  const perms = await prisma.permission.findMany();
  const permId = new Map(perms.map((p) => [p.key, p.id]));
  log(`permissions: ${perms.length}`);

  for (const r of DEFAULT_ROLES) {
    const existing = await prisma.role.findUnique({ where: { key: r.key } });
    const role = await prisma.role.upsert({
      where: { key: r.key },
      create: { key: r.key, name: r.name, description: r.description, userType: r.userType, isSystem: true },
      update: { name: r.name, description: r.description, userType: r.userType, isSystem: true },
    });
    if (!existing || opts.resetRoles) {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.createMany({ data: [...new Set(r.permissions)].map((p) => ({ roleId: role.id, permissionId: permId.get(p)! })) });
    }
  }
  log(`roles: ${DEFAULT_ROLES.length}`);

  for (const d of DEFAULT_DEPARTMENTS) {
    await prisma.department.upsert({ where: { code: d.code }, create: { ...d }, update: {} });
  }
  const depts = await prisma.department.findMany();
  const deptId = new Map(depts.map((d) => [d.code, d.id]));

  let policy = await prisma.approvalPolicy.findUnique({ where: { name: DEFAULT_POLICY.name } });
  if (!policy) {
    policy = await prisma.approvalPolicy.create({
      data: {
        name: DEFAULT_POLICY.name, description: DEFAULT_POLICY.description, isDefault: true,
        steps: { create: DEFAULT_POLICY.steps.map((s, i) => ({ sequence: i + 1, ...s })) },
      },
    });
  }

  let order = 0;
  for (const c of SERVICE_CATEGORIES) {
    const cat = await prisma.serviceCategory.upsert({
      where: { code: c.code },
      create: { code: c.code, name: c.name, description: c.description, sortOrder: order, slaTriageHours: c.sla[0], slaAssessmentDays: c.sla[1], slaDeliveryDays: c.sla[2] },
      update: {},
    });
    order++;
    await prisma.serviceDefinition.upsert({
      where: { code: `${c.code}_GENERAL` },
      create: {
        categoryId: cat.id, code: `${c.code}_GENERAL`, name: c.name, description: c.description,
        eligibility: "Any active Katsina State MDA.",
        requiredInformation: ["Problem statement", "Desired outcome", "Business justification", "Expected deliverables", "Success criteria"],
        requiredAttachments: [], assessmentChecklist: c.checklist, defaultPriority: c.defaultPriority ?? "MEDIUM",
        priorityRules: (c.rules ?? DEFAULT_RULES) as never, approvalPolicyId: policy.id, suggestedDepartmentId: deptId.get(c.dept) ?? null,
        standardDeliverables: c.deliverables,
      },
      update: {},
    });
  }
  log(`service categories: ${SERVICE_CATEGORIES.length}`);
}
