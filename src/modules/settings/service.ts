import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit } from "@/modules/audit/audit";
import type { Actor } from "@/modules/rbac/actor";
import { assertCan } from "@/modules/rbac/authorize";
import { ValidationError } from "@/lib/errors";

/**
 * Typed system settings with defaults. Values are stored in SystemSetting as
 * JSON; unknown keys are rejected. Each setting documents its purpose.
 */
export const SETTINGS = {
  "security.requireMfaForPrivileged": {
    schema: z.boolean(),
    default: true,
    description: "Require TOTP MFA for privileged roles (Super Admin, Director, Operations Admin).",
  },
  "security.maxFailedLogins": {
    schema: z.number().int().min(3).max(20),
    default: 5,
    description: "Failed sign-in attempts before temporary account lock.",
  },
  "security.lockoutMinutes": {
    schema: z.number().int().min(1).max(1440),
    default: 15,
    description: "Temporary lock duration after too many failed sign-ins.",
  },
  "workflow.assignmentAckHours": {
    schema: z.number().int().min(1).max(720),
    default: 48,
    description: "Hours an officer has to acknowledge an assignment before escalation.",
  },
  "workflow.deadlineWarningDays": {
    schema: z.number().int().min(1).max(60),
    default: 7,
    description: "Days before a due date when 'approaching deadline' warnings are raised.",
  },
  "workflow.clarificationEscalationDays": {
    schema: z.number().int().min(1).max(60),
    default: 7,
    description: "Days a clarification may remain unanswered before escalation.",
  },
  "workflow.scopeChangeWarningCount": {
    schema: z.number().int().min(1).max(20),
    default: 2,
    description: "Number of scope changes after which a project is flagged.",
  },
  "workflow.requireAllDeliverablesForClosure": {
    schema: z.boolean(),
    default: true,
    description: "Closure requires every required deliverable to be ACCEPTED or SUBMITTED.",
  },
  "progress.method": {
    schema: z.enum(["WEIGHTED_MILESTONES", "WEIGHTED_TASKS", "HYBRID"]),
    default: "HYBRID",
    description:
      "Progress calculation. WEIGHTED_MILESTONES: completed milestone weight / total weight. WEIGHTED_TASKS: done task weight / total. HYBRID: milestones weighted, each milestone's partial credit from its tasks.",
  },
  "calendar.workingDays": {
    schema: z.array(z.number().int().min(0).max(6)),
    default: [1, 2, 3, 4, 5],
    description: "Working days (0=Sunday … 6=Saturday) used for working-day SLA calculations.",
  },
  "calendar.holidays": {
    schema: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    default: [] as string[],
    description: "Public holidays (YYYY-MM-DD). Must be maintained from the official gazette; none are assumed.",
  },
  "ai.externalProcessingApproved": {
    schema: z.boolean(),
    default: false,
    description:
      "Data-governance approval to send record content to the configured external AI provider. When false, only deterministic (rule-based) intelligence runs.",
  },
  "ai.features": {
    schema: z.object({
      classification: z.boolean(),
      quality: z.boolean(),
      planning: z.boolean(),
      briefing: z.boolean(),
      analytics: z.boolean(),
      assistant: z.boolean(),
      reportDrafting: z.boolean(),
    }),
    default: { classification: true, quality: true, planning: true, briefing: true, analytics: true, assistant: true, reportDrafting: true },
    description: "Per-feature switches for AI assistance (rule-based fallbacks remain available).",
  },
  "files.allowedTypes": {
    schema: z.array(z.string()),
    default: ["pdf", "png", "jpg", "docx", "xlsx", "pptx", "csv", "txt", "zip"],
    description: "Permitted upload types (validated by file signature, not by name).",
  },
  "retention.auditYears": {
    schema: z.number().int().min(1).max(100),
    default: 10,
    description: "Minimum retention period for audit events (archival procedure in docs/SECURITY.md).",
  },
  "retention.notificationDays": {
    schema: z.number().int().min(30).max(3650),
    default: 365,
    description: "Read notifications older than this may be purged by maintenance jobs.",
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const def = SETTINGS[key];
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  if (!row) return def.default as SettingValue<K>;
  const parsed = def.schema.safeParse(row.value);
  return (parsed.success ? parsed.data : def.default) as SettingValue<K>;
}

export async function getAllSettings() {
  const rows = await prisma.systemSetting.findMany();
  const map = new Map(rows.map((r) => [r.key, r]));
  return (Object.keys(SETTINGS) as SettingKey[]).map((key) => {
    const row = map.get(key);
    const parsed = row ? SETTINGS[key].schema.safeParse(row.value) : null;
    return {
      key,
      description: SETTINGS[key].description,
      value: parsed?.success ? parsed.data : SETTINGS[key].default,
      isDefault: !row,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

const PERMISSION_FOR_PREFIX: Record<string, "system.settings.manage" | "system.ai.configure" | "escalation.configure"> = {
  ai: "system.ai.configure",
  workflow: "escalation.configure",
  calendar: "escalation.configure",
};

export async function updateSetting(actor: Actor, key: string, value: unknown) {
  if (!(key in SETTINGS)) throw new ValidationError("Unknown setting.");
  const k = key as SettingKey;
  const prefix = k.split(".")[0];
  const perm = PERMISSION_FOR_PREFIX[prefix];
  if (perm && actor.permissions.has(perm)) {
    // allowed via specific permission
  } else {
    assertCan(actor, "system.settings.manage");
  }
  const parsed = SETTINGS[k].schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(`Invalid value for ${key}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  await prisma.$transaction(async (tx) => {
    const before = await tx.systemSetting.findUnique({ where: { key } });
    await tx.systemSetting.upsert({
      where: { key },
      create: { key, value: parsed.data as never, description: SETTINGS[k].description, updatedById: actor.id },
      update: { value: parsed.data as never, updatedById: actor.id },
    });
    await audit(tx, {
      actorId: actor.id, actorEmail: actor.email, action: "settings.update", entityType: "SystemSetting", entityId: key,
      before: before?.value ?? SETTINGS[k].default, after: parsed.data,
    });
  });
}
