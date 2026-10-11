import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/modules/audit/audit";
import type { Actor } from "@/modules/rbac/actor";
import { assertCan } from "@/modules/rbac/authorize";
import { ALL_PERMISSIONS } from "@/modules/rbac/permissions";
import { priorityRulesSchema } from "@/modules/catalog/priority";

const lines = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (Array.isArray(v) ? v : (v ?? "").split("\n")).map((s) => s.trim()).filter(Boolean).slice(0, 50));
const optInt = z.coerce.number().int().min(0).max(100000).optional().or(z.literal("").transform(() => undefined));

export const categorySchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,40}$/, "Use A–Z, 0–9 and _"),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  slaTriageHours: z.coerce.number().int().min(1).max(2000).default(48),
  slaAssessmentDays: z.coerce.number().int().min(1).max(365).default(10),
  slaDeliveryDays: z.coerce.number().int().min(1).max(3650).default(90),
  active: z.coerce.boolean().default(true),
});

export const serviceSchema = z.object({
  categoryId: z.string().cuid(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,60}$/),
  name: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(5000),
  eligibility: z.string().trim().max(3000).optional(),
  requiredInformation: lines,
  requiredAttachments: lines,
  estimatedMinDays: optInt,
  estimatedMaxDays: optInt,
  assessmentChecklist: lines,
  defaultPriority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  priorityRules: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v?.trim()) return undefined;
      try {
        const parsed = priorityRulesSchema.safeParse(JSON.parse(v));
        if (!parsed.success) {
          ctx.addIssue({ code: "custom", message: "Priority rules JSON is not valid" });
          return z.NEVER;
        }
        return parsed.data;
      } catch {
        ctx.addIssue({ code: "custom", message: "Priority rules must be valid JSON" });
        return z.NEVER;
      }
    }),
  approvalPolicyId: z.string().cuid().optional().or(z.literal("").transform(() => undefined)),
  suggestedDepartmentId: z.string().cuid().optional().or(z.literal("").transform(() => undefined)),
  standardDeliverables: lines,
  slaTriageHours: optInt,
  slaAssessmentDays: optInt,
  slaDeliveryDays: optInt,
  active: z.coerce.boolean().default(true),
});

function vErr(e: z.ZodError) {
  return new ValidationError("Please correct the highlighted fields.", e.flatten().fieldErrors as Record<string, string[]>);
}

export async function listCatalog(includeInactive = false) {
  return prisma.serviceCategory.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      services: {
        where: includeInactive ? {} : { active: true },
        orderBy: { name: "asc" },
        include: { suggestedDepartment: { select: { name: true } }, approvalPolicy: { select: { name: true } } },
      },
    },
  });
}

export async function upsertCategory(actor: Actor, id: string | null, raw: unknown) {
  assertCan(actor, "catalog.manage");
  const parsed = categorySchema.safeParse(raw);
  if (!parsed.success) throw vErr(parsed.error);
  const before = id ? await prisma.serviceCategory.findUnique({ where: { id } }) : null;
  if (id && !before) throw new NotFoundError();
  const rec = id
    ? await prisma.serviceCategory.update({ where: { id }, data: parsed.data })
    : await prisma.serviceCategory.create({ data: parsed.data });
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: id ? "catalog.category_updated" : "catalog.category_created", entityType: "ServiceCategory", entityId: rec.id, before, after: parsed.data });
  return rec;
}

export async function upsertService(actor: Actor, id: string | null, raw: unknown) {
  assertCan(actor, "catalog.manage");
  const parsed = serviceSchema.safeParse(raw);
  if (!parsed.success) throw vErr(parsed.error);
  const d = parsed.data;
  if (d.estimatedMinDays !== undefined && d.estimatedMaxDays !== undefined && d.estimatedMinDays > d.estimatedMaxDays) {
    throw new ValidationError("Minimum delivery estimate cannot exceed maximum.");
  }
  const data = { ...d, priorityRules: d.priorityRules ?? undefined };
  const before = id ? await prisma.serviceDefinition.findUnique({ where: { id } }) : null;
  if (id && !before) throw new NotFoundError();
  const rec = id ? await prisma.serviceDefinition.update({ where: { id }, data }) : await prisma.serviceDefinition.create({ data });
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: id ? "catalog.service_updated" : "catalog.service_created", entityType: "ServiceDefinition", entityId: rec.id, before, after: data });
  return rec;
}

export const policyStepSchema = z.object({
  name: z.string().trim().min(3).max(120),
  requiredPermission: z.enum(["request.approve.technical", "request.approve.department", "request.approve.executive"]),
  minPriority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional().or(z.literal("").transform(() => undefined)),
  minEstimatedCostNgn: z.coerce.number().min(0).optional().or(z.literal("").transform(() => undefined)),
  minEstimatedEffortDays: z.coerce.number().int().min(0).optional().or(z.literal("").transform(() => undefined)),
});

export const policySchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).optional(),
  isDefault: z.coerce.boolean().default(false),
  steps: z.array(policyStepSchema).min(1, "A policy needs at least one step").max(10),
});

export async function listPolicies() {
  return prisma.approvalPolicy.findMany({ orderBy: { name: "asc" }, include: { steps: { orderBy: { sequence: "asc" } }, _count: { select: { services: true } } } });
}

/**
 * Replaces a policy's steps. Blocked while any request using the policy is in
 * APPROVAL_REVIEW, so that in-flight decisions are never re-interpreted.
 */
export async function savePolicy(actor: Actor, id: string | null, raw: unknown) {
  assertCan(actor, "catalog.manage");
  const parsed = policySchema.safeParse(raw);
  if (!parsed.success) throw vErr(parsed.error);
  const p = parsed.data;
  if (!p.steps.every((s) => (ALL_PERMISSIONS as string[]).includes(s.requiredPermission))) throw new ValidationError("Invalid approval permission.");
  return prisma.$transaction(async (tx) => {
    if (id) {
      const inFlight = await tx.serviceRequest.count({
        where: { status: "APPROVAL_REVIEW", OR: [{ service: { approvalPolicyId: id } }, ...(p.isDefault ? [{ service: { approvalPolicyId: null } }] : [])] },
      });
      if (inFlight) throw new AppError(`${inFlight} request(s) using this policy are in approval review. Complete them before changing the steps.`);
    }
    if (p.isDefault) await tx.approvalPolicy.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    const before = id ? await tx.approvalPolicy.findUnique({ where: { id }, include: { steps: true } }) : null;
    const policy = id
      ? await tx.approvalPolicy.update({ where: { id }, data: { name: p.name, description: p.description ?? null, isDefault: p.isDefault } })
      : await tx.approvalPolicy.create({ data: { name: p.name, description: p.description ?? null, isDefault: p.isDefault } });
    if (id) {
      // Steps referenced by historical decisions must be kept; detach by renaming sequence.
      const used = await tx.approvalDecision.findMany({ where: { step: { policyId: id } }, select: { stepId: true }, distinct: ["stepId"] });
      const usedIds = new Set(used.map((u) => u.stepId));
      const old = await tx.approvalStep.findMany({ where: { policyId: id } });
      for (const s of old) {
        if (usedIds.has(s.id)) {
          // Preserve history by moving the step into an archived policy.
          let archive = await tx.approvalPolicy.findUnique({ where: { name: `${policy.name} (archived steps)` } });
          if (!archive) archive = await tx.approvalPolicy.create({ data: { name: `${policy.name} (archived steps)`, active: false } });
          const n = await tx.approvalStep.count({ where: { policyId: archive.id } });
          await tx.approvalStep.update({ where: { id: s.id }, data: { policyId: archive.id, sequence: n + 1 } });
        } else {
          await tx.approvalStep.delete({ where: { id: s.id } });
        }
      }
    }
    await tx.approvalStep.createMany({
      data: p.steps.map((s, i) => ({
        policyId: policy.id, sequence: i + 1, name: s.name, requiredPermission: s.requiredPermission,
        minPriority: s.minPriority ?? null, minEstimatedCostNgn: s.minEstimatedCostNgn ?? null, minEstimatedEffortDays: s.minEstimatedEffortDays ?? null,
      })),
    });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: id ? "catalog.policy_updated" : "catalog.policy_created", entityType: "ApprovalPolicy", entityId: policy.id, before, after: p });
    return policy;
  });
}
